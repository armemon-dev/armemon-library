/**
 * FILE: removeSlice.ts
 * PATH: packages/cli-armemon/src/flows/removeSlice.ts
 *
 * WHAT: `armemon remove-slice` — unregisters a Redux slice and deletes its file.
 * WHY:  The exact undo of create-slice, and the same failure in reverse: deleting the
 *       file while the store still imports it breaks the build, and unregistering
 *       without deleting leaves a file nothing loads. Both halves, or neither.
 * HOW:  Refuses while another file still imports the slice, because that import is
 *       about to point at nothing — the same check remove-screen makes before it
 *       deletes a screen folder. --force goes ahead anyway and names what will break.
 * WHEN: On demand, inside a scaffolded app.
 *
 * EXPORTS: RemoveSliceOptions, runRemoveSliceFlow
 * DEPENDS ON: node:path, node:fs/promises, @armemon-library/cli-kit, ./screenShared,
 *             ./createSlice
 * USED BY: packages/cli-armemon/src/commands/removeSlice.ts
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
  removeSliceFromStore,
  storeSlices,
  validateSliceName,
} from '@armemon-library/cli-kit';
import {
  ChangeSet,
  applyOutputMode,
  commit,
  emit,
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

export interface RemoveSliceOptions extends ScreenCommandOptions {
  name?: string;
  /** Unregister it, but leave the slice file where it is. */
  keepFiles?: boolean;
  /** Remove it even though other files still import it. */
  force?: boolean;
}

export async function runRemoveSliceFlow(options: RemoveSliceOptions): Promise<void> {
  applyOutputMode(options);

  if (!options.name && isAutoAcceptEnabled()) {
    throw new CliError(
      'Name the slice to remove.',
      'e.g. armemon remove-slice cart',
    );
  }

  const { appRoot, config, layout } = await openApp(options);
  const relative = (file: string) => path.relative(appRoot, file).split(path.sep).join('/');

  const typed =
    options.name ??
    (await promptText({
      message: 'Slice name?',
      placeholder: 'cart',
      validate: (value) => validateSliceName(value.replace(/[Ss]lice$/, '')),
    }));

  let slice;
  try {
    slice = normalizeSliceName(typed, config.language);
  } catch (error) {
    throw new CliError(
      error instanceof Error ? error.message : String(error),
      'Give a name like cart, cartSlice or cart-items.',
    );
  }

  const sliceFile = path.join(appRoot, slice.file);
  const fileExists = await pathExists(sliceFile);

  const storeConfig = await findStoreConfig(appRoot, layout);
  const storeConfigFile = storeConfig === null ? null : path.join(appRoot, storeConfig);
  const registered =
    storeConfigFile === null
      ? false
      : storeSlices(await fs.readFile(storeConfigFile, 'utf8'), storeConfigFile).some(
          (entry) => entry.stateKey === slice.stateKey,
        );

  if (!fileExists && !registered) {
    throw new CliError(
      `There's no ${slice.stateKey} slice: nothing registers it and ${slice.file} doesn't exist.`,
      "The name works like create-slice's — cart, cartSlice and Cart all mean the same slice.",
    );
  }

  // ---- who still needs it -------------------------------------------------------
  const referencing: string[] = [];
  for (const file of await appSourceFiles(appRoot, layout)) {
    if (file === sliceFile || file === storeConfigFile) continue;
    const content = await fs.readFile(file, 'utf8').catch(() => null);
    if (content && (await importsNameFrom(content, file, sliceFile, slice.exportName))) {
      referencing.push(relative(file));
    }
  }

  if (referencing.length > 0 && !options.force && !options.keepFiles) {
    throw new CliError(
      `${referencing.join(', ')} still ${referencing.length === 1 ? 'imports' : 'import'} ${slice.exportName}.`,
      `Deleting it would leave ${referencing.length === 1 ? 'that import' : 'those imports'} pointing at nothing. Update them first, or pass --force to remove it anyway, or --keep-files to unregister without deleting.`,
    );
  }

  // ---- the edits, in memory -----------------------------------------------------
  const changes = new ChangeSet(appRoot);

  if (storeConfigFile && registered) {
    await realignManaged(changes, layout, [storeConfigFile]);
    const result = await changes.patch(
      storeConfigFile,
      (content) => removeSliceFromStore(content, { fileName: storeConfigFile, stateKey: slice.stateKey }),
      { action: `unregistered ${slice.stateKey} from the store` },
    );
    if (result.conflict) {
      throw new CliError(`Can't unregister ${slice.stateKey}: ${result.reason}.`, 'Nothing was written.');
    }
    // Going on would delete a file the store still imports.
    if (result.status === 'skipped') {
      throw new CliError(
        `Can't unregister ${slice.stateKey} from ${storeConfig}: ${result.reason}.`,
        `Nothing was written. ${result.manual ?? ''}`.replace(/\s+/g, ' '),
      );
    }
  }

  const deleting = fileExists && !options.keepFiles;

  if (options.dryRun) {
    if (deleting) logger.info(`Would delete ${slice.file}`);
    printChanges(changes);
    emit(
      { ok: true, dryRun: true, name: slice.stateKey, deleted: deleting, referencedBy: referencing },
      options,
    );
    return;
  }

  await commit(changes, { deleteFiles: deleting ? [sliceFile] : [] });

  if (deleting) logger.success(`Deleted ${slice.file}`);
  else if (fileExists) logger.info(`Kept ${slice.file} — it is no longer registered.`);
  printOutcomes(changes);
  for (const file of referencing) {
    logger.warn(`${file} still imports ${slice.exportName}, which is now gone.`);
  }

  const touched = [slice.file, ...changes.outcomes.map((outcome) => outcome.file)];
  const verification = await verifyApp(appRoot, config, options);
  printVerification(verification, { touched });

  const skipped = changes.outcomes.filter((outcome) => outcome.status === 'skipped');
  emit(
    {
      ok: skipped.length === 0 && (verification?.ok ?? true),
      name: slice.stateKey,
      deleted: deleting,
      referencedBy: referencing,
      outcomes: changes.outcomes,
      verification: verificationSummary(verification, touched),
    },
    options,
  );
}
