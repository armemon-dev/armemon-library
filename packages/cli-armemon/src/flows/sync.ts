/**
 * FILE: sync.ts
 * PATH: packages/cli-armemon/src/flows/sync.ts
 *
 * WHAT: `armemon sync` — puts the managed zone back into the shape every other
 *       command expects, and moves a legacy `src/armemon/` up to `armemon/`.
 * WHY:  Two things drift. A managed file that was hand-edited is still valid code but
 *       no longer canonical, and every command re-aligns the handful of files it
 *       touches — never the rest. And apps scaffolded before the managed zone moved to
 *       the app root keep it under src/, which works but leaves them permanently
 *       reading as "legacy". Both need one command that fixes the whole zone at once.
 * HOW:  The move is the hard half, because it changes the distance of every import
 *       that crosses between the two zones — outward from the files that move, inward
 *       from the files that don't, and from the App entry at the root. None of that is
 *       done with string edits: each specifier is resolved to the real module it names,
 *       then recomputed from where the file will be. Anything that cannot be resolved
 *       is reported and left alone rather than guessed at.
 *
 *       Everything is computed in memory and committed in one transaction, so a
 *       failure part-way through puts the folder and every file back.
 * WHEN: On demand, and after hand-editing anything under the managed zone.
 *
 * EXPORTS: SyncOptions, runSyncFlow
 * DEPENDS ON: node:path, @armemon-library/cli-kit, ./screenShared
 * USED BY: packages/cli-armemon/src/commands/sync.ts
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import type { ArmemonAppConfig } from '@armemon-library/config-types';
import {
  CliError,
  DEFAULT_LAYOUT,
  LEGACY_MANAGED_DIR,
  MANAGED_DIR,
  appSourceFiles,
  managedReadme,
  formatManagedSource,
  isManaged,
  logger,
  managedRoot,
  readPathAliases,
  resolveRelativeModule,
  rewriteModuleSpecifiers,
  sourceSyntaxErrors,
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
  verificationSummary,
  verifyApp,
  type ScreenCommandOptions,
} from './screenShared.js';

export interface SyncOptions extends ScreenCommandOptions {
  /** The full command reference, generated from the live program by the command layer. */
  commandReference?: string;
}

const SOURCE = /\.[jt]sx?$/;

/** Config files that can name the managed folder by path, and that sync won't edit. */
const CONFIG_FILES = [
  'tsconfig.json',
  'jsconfig.json',
  'babel.config.js',
  'metro.config.js',
  'jest.config.js',
  'jest.config.ts',
  'package.json',
  'app.json',
  '.eslintrc.js',
  '.eslintrc.json',
  'eslint.config.js',
  'eslint.config.mjs',
];

/**
 * The path aliases this app's imports can be written through.
 *
 * tsconfig's `paths`, which is where a TypeScript app declares them, and the `@/`
 * alias armemon's advanced-init plugin sets up in Babel — the one a JavaScript app,
 * with no tsconfig, still has. Before this, `import … from '@/armemon/…'` was skipped
 * as if it were a package, and broke silently when the folder moved out of src/.
 */
async function projectAliases(
  appRoot: string,
  config: ArmemonAppConfig,
): Promise<Array<{ prefix: string; target: string }>> {
  const aliases = readPathAliases(appRoot);

  const advanced = config.plugins?.['advanced-init'] as { pathAliases?: boolean } | undefined;
  if (advanced?.pathAliases && !aliases.some((alias) => alias.prefix === '@/')) {
    aliases.push({ prefix: '@/', target: path.join(appRoot, 'src') });
  }

  // Longest prefix first, so `@/armemon/` wins over `@/` when both are declared.
  return aliases.sort((a, b) => b.prefix.length - a.prefix.length);
}

/** Config files that still name the legacy folder — sync reports them rather than editing them. */
async function configMentions(appRoot: string): Promise<string[]> {
  const mentions: string[] = [];
  for (const name of CONFIG_FILES) {
    const content = await fs.readFile(path.join(appRoot, name), 'utf8').catch(() => null);
    if (content?.includes(LEGACY_MANAGED_DIR)) mentions.push(name);
  }
  return mentions;
}

export async function runSyncFlow(options: SyncOptions): Promise<void> {
  applyOutputMode(options);

  const { appRoot, config, layout } = await openApp(options);
  const relative = (file: string) => path.relative(appRoot, file).split(path.sep).join('/');

  const oldRoot = managedRoot(appRoot, layout);
  const newRoot = path.join(appRoot, MANAGED_DIR);

  // Asked of the disk rather than inferred from the layout. readLayout answers "where
  // does armemon read from", and it prefers armemon/ when both folders exist — so an
  // app half-way through a migration reports as current, and a refusal written as
  // `layout.legacy && armemon/ exists` can never fire.
  const hasLegacy = await pathExists(path.join(appRoot, ...LEGACY_MANAGED_DIR.split('/')));
  const hasCurrent = await pathExists(newRoot);

  // Not a layout armemon can reason about, and picking one silently discards the
  // other — which, since src/armemon/ is where the real files still are, is the one
  // case where saying nothing is worse than stopping.
  if (hasLegacy && hasCurrent) {
    throw new CliError(
      `This app has both ${LEGACY_MANAGED_DIR}/ and ${MANAGED_DIR}/.`,
      `armemon can't tell which one is real. Merge them by hand and delete the one you don't want, then run this again.`,
    );
  }

  const moving = hasLegacy && !hasCurrent;

  /** Where a file — or anything a file points at — ends up after the move. */
  const relocate = (target: string): string =>
    moving && (target === oldRoot || target.startsWith(`${oldRoot}${path.sep}`))
      ? path.join(newRoot, path.relative(oldRoot, target))
      : target;

  const changes = new ChangeSet(appRoot);
  const unresolved: Array<{ file: string; specifiers: string[] }> = [];
  const unparsable: string[] = [];
  const aliases = moving ? await projectAliases(appRoot, config) : [];
  const mentions = moving ? await configMentions(appRoot) : [];

  for (const file of await appSourceFiles(appRoot, layout)) {
    const original = await changes.read(file);
    if (original === null) continue;

    // Rewriting a file armemon cannot parse is how a sync corrupts a project. Report
    // it and move on — the rest of the app still gets fixed.
    if (sourceSyntaxErrors(original, file).length > 0) {
      unparsable.push(relative(file));
      continue;
    }

    const destination = relocate(file);
    let content = original;

    if (moving) {
      const rewrite = await rewriteModuleSpecifiers(content, {
        fromFile: file,
        toFile: destination,
        resolve: resolveRelativeModule,
        relocate,
        aliases,
        watchSegment: MANAGED_DIR,
      });
      content = rewrite.content;
      if (rewrite.unresolved.length > 0) {
        unresolved.push({ file: relative(file), specifiers: rewrite.unresolved });
      }
    }

    // Judged by where the file ENDS UP: a migration's whole point is that these files
    // are about to become managed at their new path.
    if (SOURCE.test(destination) && isManaged(DEFAULT_LAYOUT, relative(destination))) {
      content = await formatManagedSource(content, destination);
    }

    const moved = destination !== file;
    if (content === original && !moved) continue;

    // `before` is the original content rather than null. commit() renames the folder
    // BEFORE it writes staged files, so by then the file already exists at its new
    // path — undo has to restore those bytes, not delete the file.
    await changes.stage(destination, content, original);
    changes.record({
      file: relative(destination),
      status: moved ? 'changed' : 're-aligned',
      action: moved ? `moved from ${relative(file)}` : 're-aligned formatting',
    });
  }

  // Regenerated rather than patched: it is armemon's own prose, and the command
  // reference in it describes whichever CLI version is running now.
  const guidePath = path.join(appRoot, MANAGED_DIR, 'README.md');
  const guide = `${managedReadme(moving ? DEFAULT_LAYOUT : layout, {
    plugins: Object.keys(config.plugins ?? {}),
    language: config.language ?? 'typescript',
  })}${options.commandReference ?? ''}`;

  // Looked for at BOTH paths. commit() renames the folder before it writes staged
  // files, so a legacy app's existing guide is already sitting at the new path by
  // then — staged with before:null, a failed commit would delete it instead of
  // putting it back. appSourceFiles doesn't cover .md, so nothing else catches this.
  const existingGuide =
    (await changes.read(guidePath)) ??
    (moving ? await changes.read(path.join(oldRoot, 'README.md')) : null);

  if (options.commandReference !== undefined && existingGuide !== guide) {
    await changes.stage(guidePath, guide, existingGuide);
    changes.record({
      file: relative(guidePath),
      status: 'changed',
      action: 'refreshed the guide',
    });
  }

  const edits = changes.changes.length;
  const nothingToDo = !moving && edits === 0;

  if (nothingToDo) {
    if (!options.json) {
      logger.success(`${layout.managed}/ is already in shape — nothing to change.`);
      if (unparsable.length > 0) {
        logger.warn(`Skipped ${unparsable.length} file(s) armemon couldn't parse: ${unparsable.join(', ')}.`);
      }
    }
    emit({ ok: unparsable.length === 0, appRoot, moved: null, changed: 0, unparsable, unresolved }, options);
    return;
  }

  const mentionHint = (verb: string) =>
    `${mentions.join(', ')} ${mentions.length === 1 ? verb : verb.replace(/s$/, '')} ${LEGACY_MANAGED_DIR}/ by path. armemon doesn't edit config files — change those paths to ${MANAGED_DIR}/ by hand.`;

  if (options.dryRun) {
    if (moving) logger.info(`Would move ${layout.managed}/ to ${MANAGED_DIR}/`);
    printChanges(changes);
    if (mentions.length > 0) logger.warn(mentionHint('names'));
    emit(
      {
        ok: unparsable.length === 0,
        appRoot,
        dryRun: true,
        moved: moving ? { from: layout.managed, to: MANAGED_DIR } : null,
        changed: edits,
        unparsable,
        unresolved,
        configMentions: mentions,
      },
      options,
    );
    return;
  }

  await commit(changes, moving ? { moves: [[oldRoot, newRoot]] } : {});

  if (moving) logger.success(`Moved ${layout.managed}/ to ${MANAGED_DIR}/`);
  printOutcomes(changes);

  // Every unresolved specifier is a path armemon left exactly as it found it, which
  // after a move may now point at nothing. Naming them is the whole value.
  for (const entry of unresolved) {
    logger.warn(`${entry.file} — couldn't resolve ${entry.specifiers.join(', ')}, left unchanged.`);
  }
  for (const file of unparsable) {
    logger.warn(`${file} — doesn't parse, so armemon left it alone.`);
  }
  if (mentions.length > 0) logger.warn(mentionHint('names'));

  const touched = changes.outcomes.map((outcome) => outcome.file);
  const verification = await verifyApp(appRoot, config, options);
  printVerification(verification, { touched });

  emit(
    {
      ok: unparsable.length === 0 && (verification?.ok ?? true),
      appRoot,
      moved: moving ? { from: layout.managed, to: MANAGED_DIR } : null,
      changed: edits,
      outcomes: changes.outcomes,
      unparsable,
      unresolved,
      configMentions: mentions,
      verification: verificationSummary(verification, touched),
    },
    options,
  );
}
