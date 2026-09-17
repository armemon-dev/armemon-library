/**
 * FILE: createSlice.ts
 * PATH: packages/cli-armemon/src/flows/createSlice.ts
 *
 * WHAT: `armemon create-slice` — writes a Redux slice in your zone and registers it
 *       in the managed store config.
 * WHY:  Adding a slice by hand is three steps in two zones: write the file, import it
 *       in store.config, add the line inside `slices: {}`. Forgetting the last one
 *       produces an app that compiles and whose `state.cart` is undefined — no error,
 *       nothing to search for. The generated store.config has said "armemon
 *       create-slice Cart writes the slice and adds both lines for you" since the
 *       layout change; this is the command that keeps that promise.
 * HOW:  The file goes to src/store/slices/ and is yours from that moment. The two
 *       edits to store.config are parser-backed, so the commented-out example in that
 *       file — which is character-for-character what a real entry looks like — is
 *       never mistaken for one. Everything is computed first and committed in one
 *       transaction, so a failure leaves nothing half-written.
 * WHEN: On demand, inside a scaffolded app with the Redux plugin.
 *
 * EXPORTS: CreateSliceOptions, runCreateSliceFlow
 * DEPENDS ON: node:path, @armemon-library/cli-kit, @armemon-library/config-types, ./screenShared
 * USED BY: packages/cli-armemon/src/commands/createSlice.ts
 */

import path from 'node:path';
import {
  CliError,
  addSliceToStore,
  buildSliceFile,
  convertFilesToJavaScript,
  isAutoAcceptEnabled,
  logger,
  normalizeSliceName,
  promptText,
  storeSlices,
  validateSliceName,
} from '@armemon-library/cli-kit';
import { managedFile, managedPath, specifierFor, type AppLayout } from '@armemon-library/config-types';
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

export interface CreateSliceOptions extends ScreenCommandOptions {
  name?: string;
  /** Write the file but leave store.config alone. */
  register?: boolean;
  /** Replace the slice file if it already exists. */
  force?: boolean;
}

/**
 * The store config as it is on disk.
 *
 * managedFile.storeConfig names the .ts spelling, which is right for a plan — the
 * language conversion renames it afterwards. Reading one back needs the name the app
 * actually has.
 */
export async function findStoreConfig(appRoot: string, layout: AppLayout): Promise<string | null> {
  for (const extension of ['ts', 'js']) {
    const relative = `${managedPath(layout, 'redux', 'store.config')}.${extension}`;
    if (await pathExists(path.join(appRoot, relative))) return relative;
  }
  return null;
}

export async function runCreateSliceFlow(options: CreateSliceOptions): Promise<void> {
  applyOutputMode(options);

  if (!options.name && isAutoAcceptEnabled()) {
    throw new CliError(
      'Give the slice a name — there is no sensible default to accept.',
      'e.g. armemon create-slice cart',
    );
  }

  const { appRoot, config, layout } = await openApp(options);

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

  // ---- where it is going --------------------------------------------------------
  const sliceFile = path.join(appRoot, slice.file);
  if ((await pathExists(sliceFile)) && !options.force) {
    throw new CliError(
      `${slice.file} already exists.`,
      'Pass --force to replace it, or pick another name.',
    );
  }

  const storeConfig = options.register === false ? null : await findStoreConfig(appRoot, layout);
  if (options.register !== false && storeConfig === null) {
    throw new CliError(
      'redux' in (config.plugins ?? {})
        ? `This app has the Redux plugin but no ${managedFile.storeConfig(layout)}.`
        : "This app doesn't have the Redux plugin, so there is no store to register a slice in.",
      'redux' in (config.plugins ?? {})
        ? 'Restore it from version control. Or pass --no-register to write the slice file only.'
        : 'Add it with "armemon plugin add redux" — or pass --no-register to write the slice file only, and use it with your own store.',
    );
  }

  // ---- the file -----------------------------------------------------------------
  let files = [
    buildSliceFile({
      name: slice,
      storeConfigPath: storeConfig ?? managedFile.storeConfig(layout),
    }),
  ];
  if (config.language === 'javascript') files = (await convertFilesToJavaScript(files)).files;

  // ---- the edits, in memory -----------------------------------------------------
  const changes = new ChangeSet(appRoot);
  let registered = false;

  if (storeConfig) {
    const storeConfigFile = path.join(appRoot, storeConfig);
    await realignManaged(changes, layout, [storeConfigFile]);

    const already = storeSlices(
      (await changes.read(storeConfigFile)) ?? '',
      storeConfigFile,
    ).some((entry) => entry.stateKey === slice.stateKey);

    if (already && !options.force) {
      throw new CliError(
        `"${slice.stateKey}" is already registered in ${storeConfig}.`,
        'Pick another name, or pass --force to overwrite the slice file and leave the store entry as it is.',
      );
    }

    const result = await changes.patch(
      storeConfigFile,
      (content) =>
        addSliceToStore(content, {
          fileName: storeConfigFile,
          stateKey: slice.stateKey,
          exportName: slice.exportName,
          from: specifierFor(storeConfig, slice.file),
        }),
      { action: `registered ${slice.stateKey} in the store` },
    );
    if (result.conflict) {
      throw new CliError(`Can't register ${slice.stateKey}: ${result.reason}.`, 'Nothing was written.');
    }

    // A slice file written but never registered is the exact failure this command
    // exists to prevent: the app compiles, state.<name> is undefined, and nothing
    // says why. So a refused store edit stops the run before anything is committed —
    // --no-register is how you ask for the file on its own.
    if (result.status === 'skipped') {
      throw new CliError(
        `Can't register ${slice.stateKey} in ${storeConfig}: ${result.reason}.`,
        `Nothing was written. ${result.manual ?? ''} Or pass --no-register to write just the slice file.`.replace(/\s+/g, ' '),
      );
    }
    // Past the refusal above, the edit landed.
    registered = true;
  }

  // ---- write, or say what would happen ------------------------------------------
  if (options.dryRun) {
    logger.info(`Would create ${slice.file}`);
    printChanges(changes);
    emit(
      { ok: true, dryRun: true, name: slice.stateKey, file: slice.file, registered },
      options,
    );
    return;
  }

  await commit(changes, { create: files });

  logger.success(`Created ${slice.file}`);
  printOutcomes(changes);
  if (!registered && storeConfig === null) {
    logger.info(`Not registered — add it to ${managedFile.storeConfig(layout)} yourself, or re-run without --no-register.`);
  }
  logger.info(`Read it from state with: useSelector((state) => state.${slice.stateKey}.value)`);

  const touched = [slice.file, ...changes.outcomes.map((outcome) => outcome.file)];
  const verification = await verifyApp(appRoot, config, options);
  printVerification(verification, {
    touched,
    undoHint: `Undo with: armemon remove-slice ${slice.stateKey}`,
  });

  const skipped = changes.outcomes.filter((outcome) => outcome.status === 'skipped');
  emit(
    {
      ok: skipped.length === 0 && (verification?.ok ?? true),
      name: slice.stateKey,
      file: slice.file,
      exportName: slice.exportName,
      registered,
      outcomes: changes.outcomes,
      verification: verificationSummary(verification, touched),
    },
    options,
  );
}
