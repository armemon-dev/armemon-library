/**
 * FILE: renameSlice.ts
 * PATH: packages/cli-armemon/src/flows/renameSlice.ts
 *
 * WHAT: `armemon rename-slice` — renames a Redux slice everywhere it is named.
 * WHY:  A slice's name appears in five places that all have to agree: the file, the
 *       exported binding, the key in the store's `slices`, the `name` field, and the
 *       action types built from that field. Renaming by hand means finding all five,
 *       and the one people miss is the `name` field — which moves `state.cart` to
 *       `state.basket` while every action keeps dispatching `cart/…`.
 * HOW:  The file moves, its binding and `name` field are rewritten, the store entry
 *       and every importer follow. What armemon cannot fix is a dispatch written as a
 *       string — `dispatch({ type: 'cart/set' })` is just text — so those are found
 *       and reported rather than silently left behind.
 * WHEN: On demand, inside a scaffolded app.
 *
 * EXPORTS: RenameSliceOptions, runRenameSliceFlow
 * DEPENDS ON: node:path, node:fs/promises, @armemon-library/cli-kit, ./screenShared,
 *             ./createSlice
 * USED BY: packages/cli-armemon/src/commands/renameSlice.ts
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import {
  CliError,
  appSourceFiles,
  importsNameFrom,
  isAutoAcceptEnabled,
  logger,
  normalizeSliceName,
  promptText,
  renameSliceDeclaration,
  renameSliceImport,
  renameSliceInStore,
  storeSlices,
  validateSliceName,
} from '@armemon-library/cli-kit';
import {
  ChangeSet,
  applyOutputMode,
  commit,
  emit,
  moduleSpecifier,
  openApp,
  pathExists,
  printChanges,
  printOutcomes,
  printVerification,
  realignManaged,
  verificationSummary,
  verifyApp,
  type ScreenCommandOptions,
} from './screenShared.js';
import { findStoreConfig } from './createSlice.js';

export interface RenameSliceOptions extends ScreenCommandOptions {
  /** Asked for when missing, like create-slice and remove-slice — unless nothing may ask. */
  from?: string;
  to?: string;
}

export async function runRenameSliceFlow(options: RenameSliceOptions): Promise<void> {
  applyOutputMode(options);

  if ((!options.from || !options.to) && isAutoAcceptEnabled()) {
    throw new CliError('Name the slice and what to call it.', 'e.g. armemon rename-slice cart basket');
  }

  const { appRoot, config, layout } = await openApp(options);

  const validate = (value: string) => validateSliceName(value.replace(/[Ss]lice$/, ''));
  const typedFrom =
    options.from || (await promptText({ message: 'Which slice?', placeholder: 'cart', validate }));
  const typedTo =
    options.to || (await promptText({ message: `Rename ${typedFrom} to?`, placeholder: 'basket', validate }));
  const relative = (file: string) => path.relative(appRoot, file).split(path.sep).join('/');

  const read = (value: string) => {
    try {
      return normalizeSliceName(value, config.language);
    } catch (error) {
      throw new CliError(
        error instanceof Error ? error.message : String(error),
        'Give a name like cart, cartSlice or cart-items.',
      );
    }
  };
  const from = read(typedFrom);
  const to = read(typedTo);

  if (from.stateKey === to.stateKey) {
    throw new CliError(`"${typedFrom}" and "${typedTo}" are the same slice, ${from.stateKey}.`, 'Pick a different name.');
  }

  const fromFile = path.join(appRoot, from.file);
  const toFile = path.join(appRoot, to.file);
  if (await pathExists(toFile)) {
    throw new CliError(`${to.file} already exists.`, 'Pick another name, or remove that slice first with armemon remove-slice.');
  }
  const fileExists = await pathExists(fromFile);

  const storeConfig = await findStoreConfig(appRoot, layout);
  const storeConfigFile = storeConfig === null ? null : path.join(appRoot, storeConfig);
  const registered =
    storeConfigFile === null
      ? false
      : storeSlices(await fs.readFile(storeConfigFile, 'utf8'), storeConfigFile).some(
          (entry) => entry.stateKey === from.stateKey,
        );

  if (!fileExists && !registered) {
    throw new CliError(
      `There's no ${from.stateKey} slice: nothing registers it and ${from.file} doesn't exist.`,
      "The name works like create-slice's — cart, cartSlice and Cart all mean the same slice.",
    );
  }

  // ---- every edit, in memory ----------------------------------------------------
  const changes = new ChangeSet(appRoot);

  if (storeConfigFile && registered) {
    await realignManaged(changes, layout, [storeConfigFile]);
    const result = await changes.patch(
      storeConfigFile,
      (content) =>
        renameSliceInStore(content, {
          fileName: storeConfigFile,
          from: from.stateKey,
          to: to.stateKey,
          fromExport: from.exportName,
          toExport: to.exportName,
          toModule: moduleSpecifier(storeConfigFile, toFile),
        }),
      { action: `renamed ${from.stateKey} to ${to.stateKey} in the store` },
    );
    if (result.conflict) {
      throw new CliError(`Can't rename ${from.stateKey}: ${result.reason}.`, 'Nothing was written.');
    }
    if (result.status === 'skipped') {
      throw new CliError(
        `Can't rename ${from.stateKey} in ${storeConfig}: ${result.reason}.`,
        `Nothing was written. ${result.manual ?? ''}`.replace(/\s+/g, ' '),
      );
    }
  }

  // The slice file itself: staged at its new path, because commit moves the file
  // before it writes, so by then it is already there under the old contents.
  if (fileExists) {
    const original = await changes.read(fromFile);
    if (original !== null) {
      const renamed = renameSliceDeclaration(original, {
        fileName: fromFile,
        fromExport: from.exportName,
        toExport: to.exportName,
        from: from.stateKey,
        to: to.stateKey,
      });
      await changes.stage(toFile, renamed.changed ? renamed.content : original, original);
      changes.record({ file: to.file, status: 'changed', action: `renamed from ${from.file}` });
    }
  }

  // ---- everyone else who imports it ---------------------------------------------
  const dispatchers: string[] = [];
  const prefix = new RegExp(`['"\`]${from.stateKey}/`);

  for (const file of await appSourceFiles(appRoot, layout)) {
    if (file === fromFile || file === storeConfigFile) continue;
    const content = await changes.read(file);
    if (content === null) continue;

    if (await importsNameFrom(content, file, fromFile, from.exportName)) {
      await changes.patch(
        file,
        (current) =>
          renameSliceImport(current, {
            fileName: file,
            fromExport: from.exportName,
            toExport: to.exportName,
            toModule: moduleSpecifier(file, toFile),
          }),
        { action: `renamed ${from.exportName} to ${to.exportName}`, reportAlready: false },
      );
    }

    // Action types are strings. Nothing can rewrite them safely, so they are named.
    if (prefix.test(content)) dispatchers.push(relative(file));
  }

  if (options.dryRun) {
    logger.info(`Would move ${from.file} to ${to.file}`);
    printChanges(changes);
    emit({ ok: true, dryRun: true, from: from.stateKey, to: to.stateKey, dispatchers }, options);
    return;
  }

  await commit(changes, { moves: fileExists ? [[fromFile, toFile]] : [] });

  if (fileExists) logger.success(`Moved ${from.file} to ${to.file}`);
  printOutcomes(changes);

  if (dispatchers.length > 0) {
    logger.warn(
      `Action types are strings, so these still dispatch "${from.stateKey}/…": ${dispatchers.join(', ')}. Change them to "${to.stateKey}/…" by hand.`,
    );
  }

  const touched = [to.file, ...changes.outcomes.map((outcome) => outcome.file)];
  const verification = await verifyApp(appRoot, config, options);
  printVerification(verification, {
    touched,
    undoHint: `Undo with: armemon rename-slice ${to.stateKey} ${from.stateKey}`,
  });

  const skipped = changes.outcomes.filter((outcome) => outcome.status === 'skipped');
  emit(
    {
      ok: skipped.length === 0 && (verification?.ok ?? true),
      from: from.stateKey,
      to: to.stateKey,
      file: to.file,
      dispatchers,
      outcomes: changes.outcomes,
      verification: verificationSummary(verification, touched),
    },
    options,
  );
}
