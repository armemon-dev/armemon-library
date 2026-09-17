/**
 * FILE: transaction.ts
 * PATH: packages/cli-armemon/src/flows/plugins/transaction.ts
 *
 * WHAT: Carries out a reconciled plugin change: stops and explains when something is in
 *       the way, shows it on --dry-run, and otherwise writes it, installs, finishes the
 *       post-install work and checks the app — reporting all of it as prose or JSON.
 * WHY:  The file edits and the package install are one change. An install that fails
 *       after the files are written leaves an app whose code imports packages it
 *       doesn't have, so a failed or interrupted install puts every file — and the
 *       lockfile — back the way it was.
 * HOW:  Blockers stop everything unless --force, which goes ahead without them and
 *       lists each one as left to do. The commit returns its own undo; lockfiles are
 *       read before the install and written back on failure. jest.setup.js is edited
 *       after the install, so a package's own published mock can be found.
 * WHEN: At the end of `armemon plugin add` and `armemon plugin remove`.
 *
 * EXPORTS: carryOut, PluginRunOptions, PluginTarget
 * DEPENDS ON: node:path, node:fs/promises, @armemon-library/cli-kit,
 *             @armemon-library/config-types, ../screenShared, ../pods, ./appState, ./reconcile
 * USED BY: flows/plugins/addPlugin.ts, flows/plugins/removePlugin.ts
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import {
  CancelledError,
  CliError,
  buildJestSetupSource,
  getLogStream,
  installDependencies,
  logger,
  officialMockProbe,
  patchJestSetup,
  promptConfirm,
  verifyGeneratedApp,
  withOutputStep,
  withSpinner,
  type DiscoveredPlugin,
  type VerificationReport,
} from '@armemon-library/cli-kit';
import type { PluginInstallPlan } from '@armemon-library/config-types';
import { commit, emit, lineDiff, type ScreenCommandOptions } from '../screenShared.js';
import { tryPodInstall } from '../pods.js';
import type { AppState } from './appState.js';
import type { Blocker, Reconciliation } from './reconcile.js';

export interface PluginRunOptions extends ScreenCommandOptions {
  /** Go ahead past blockers, leaving each blocked file or edit as it is. */
  force?: boolean;
  /** The command reference the managed guide ends with. */
  commandReference?: string;
}

export interface PluginTarget {
  pluginId: string;
  plugin: DiscoveredPlugin;
  plan: PluginInstallPlan;
  action: 'add' | 'remove';
}

const LOCKFILES = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock'];

const print = (line: string) => (getLogStream() === 'stderr' ? console.error(line) : console.log(line));

function describeBlocker(blocker: Blocker): string {
  return blocker.file ? `${blocker.file} — ${blocker.reason}` : blocker.reason;
}

function printBlockers(blockers: Blocker[], heading: string): void {
  logger.warn(heading);
  for (const blocker of blockers) {
    print(`  • ${describeBlocker(blocker)}`);
    if (blocker.manual) for (const line of blocker.manual.split('\n')) print(`      ${line}`);
  }
}

/** Empty folders a deletion left behind, up to — never including — the zone it was in. */
async function pruneEmptyFolders(appRoot: string, deleted: string[], managed: string): Promise<void> {
  // Only folders the removal emptied, and never a zone itself.
  const stops = new Set(['', '.', 'src', managed]);
  const folders = [...new Set(deleted.map((relative) => path.posix.dirname(relative)))].sort((a, b) => b.length - a.length);
  for (const start of folders) {
    let folder = start;
    while (!stops.has(folder)) {
      const full = path.join(appRoot, ...folder.split('/'));
      const entries = await fs.readdir(full).catch(() => null);
      if (entries === null || entries.length > 0) break;
      await fs.rmdir(full).catch(() => undefined);
      folder = path.posix.dirname(folder);
    }
  }
}

export async function carryOut(input: {
  state: AppState;
  rec: Reconciliation;
  target: PluginTarget;
  options: PluginRunOptions;
}): Promise<void> {
  const { state, rec, target, options } = input;
  const { appRoot } = state;
  const adding = target.action === 'add';
  const verb = adding ? 'add' : 'remove';
  const name = target.plugin.manifest.displayName;

  const relative = (file: string) => path.relative(appRoot, file).split(path.sep).join('/');
  const edited = rec.changes.changes.map((change) => relative(change.file)).filter((file) => !rec.created.includes(file));
  // Written after the install, but part of the change all the same.
  if (rec.jest && !edited.includes('jest.setup.js')) edited.push('jest.setup.js');
  const planNotes = adding ? (target.plan.postInstallNotes ?? []) : (target.plan.removalNotes ?? []);
  const summary = {
    action: verb,
    plugin: target.pluginId,
    created: rec.created,
    edited,
    deleted: rec.deletions,
    dependencies: {
      added: { ...rec.dependencies.add, ...rec.dependencies.addDev },
      removed: rec.dependencies.remove,
      kept: rec.dependencies.kept,
      conflicts: rec.dependencies.conflicts,
    },
    kept: rec.kept,
    notes: rec.notes,
    [adding ? 'postInstallNotes' : 'removalNotes']: planNotes,
  };

  // ---- R1: anything in the way stops everything, unless --force -----------------------
  if (rec.blockers.length > 0 && !options.force) {
    if (options.json) {
      emit({ ok: false, ...summary, blocked: rec.blockers }, options);
      return;
    }
    printBlockers(
      rec.blockers,
      `Nothing was changed — ${rec.blockers.length === 1 ? 'one thing needs' : `${rec.blockers.length} things need`} you before armemon can ${verb} ${name}:`,
    );
    logger.info(
      `Run with --dry-run to see the whole change, or --force to go ahead and leave ${rec.blockers.length === 1 ? 'that' : 'those'} as ${rec.blockers.length === 1 ? 'it is' : 'they are'}.`,
    );
    process.exitCode = 1;
    return;
  }
  const skipped = options.force ? rec.blockers : [];
  // What --force left for the person to do isn't something the checks can expect to find.
  for (const { file } of skipped) {
    const expectations = rec.expectations;
    if (file === 'babel.config.js') delete expectations.babelPlugins;
    if (file === 'index.js') delete expectations.entryPrelude;
    if (file === 'web/index.html') delete expectations.htmlSnippets;
    if (file === '.gitignore') delete expectations.gitignoreEntries;
    if (file && expectations.files) expectations.files = expectations.files.filter((entry) => entry !== file);
  }

  // ---- R1: --dry-run shows the whole change ---------------------------------------------
  if (options.dryRun) {
    if (options.json) {
      emit({ ok: true, dryRun: true, ...summary, skipped }, options);
      return;
    }
    logger.info(`Dry run — nothing was written. To ${verb} ${name}:`);
    for (const file of rec.created) print(`  + create ${file}`);
    for (const change of rec.changes.changes.filter((entry) => !rec.created.includes(relative(entry.file)))) {
      print(`  ~ edit   ${relative(change.file)}`);
      for (const line of lineDiff(change.before ?? '', change.after)) print(`      ${line}`);
    }
    if (rec.jest) {
      const mocks = [...rec.jest.add.map((name) => `+${name}`), ...rec.jest.remove.map((name) => `-${name}`)];
      print(`  ~ edit   jest.setup.js — after the install: mocks ${mocks.join(', ')}`);
    }
    for (const file of rec.deletions) print(`  - delete ${file}`);
    printOutcome(rec, skipped, planNotes, adding);
    return;
  }

  // ---- confirm what can't be taken back by the command itself ---------------------------
  if (!adding) {
    const proceed = await promptConfirm({
      message: `Remove ${name}? ${rec.deletions.length} file(s) deleted, ${rec.dependencies.remove.length} package(s) uninstalled.`,
      initialValue: true,
    });
    if (!proceed) throw new CancelledError();
  }

  // ---- write, install, and put everything back if the install fails ----------------------
  let interrupted = false;
  const onInterrupt = () => {
    if (interrupted) process.exit(130);
    interrupted = true;
    logger.warn('Stopping — every change will be put back. Press Ctrl-C again to quit at once, without that.');
  };
  process.on('SIGINT', onInterrupt);

  const lockfiles = new Map<string, Buffer | null>();
  for (const file of LOCKFILES) lockfiles.set(file, await fs.readFile(path.join(appRoot, file)).catch(() => null));

  let verification: VerificationReport | null = null;
  const postInstallNotes = [...planNotes];
  try {
    const { rollback } = await commit(rec.changes, { deleteFiles: rec.deletions.map((file) => path.join(appRoot, ...file.split('/'))) });
    const copied: string[] = [];
    const undoAll = async () => {
      for (const file of copied) await fs.rm(file, { force: true });
      await rollback();
      for (const [file, content] of lockfiles) {
        const full = path.join(appRoot, file);
        if (content === null) await fs.rm(full, { force: true });
        else await fs.writeFile(full, content);
      }
    };

    try {
      for (const copy of rec.copies) {
        const destination = path.join(appRoot, ...copy.to.split('/'));
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.copyFile(copy.from, destination);
        copied.push(destination);
      }
      if (interrupted) throw new CancelledError();

      const packagesChanged = rec.changes.changes.some((change) => relative(change.file) === 'package.json');
      if (packagesChanged) {
        await withOutputStep(adding ? 'Installing packages…' : 'Removing packages…', () =>
          installDependencies(appRoot, state.packageManager, {
            onRetry: (error) => logger.warn(`Install failed, retrying once. (${error.message.split('\n')[0]})`),
          }),
        );
      }
      if (interrupted) throw new CancelledError();
    } catch (error) {
      await undoAll();
      if (interrupted || error instanceof CancelledError) {
        logger.info(
          `Every file is back the way it was. node_modules may still hold part of the install — run "${state.packageManager} install" to settle it.`,
        );
        throw new CancelledError();
      }
      throw new CliError(
        `The install failed, so every change was put back — no file in the app changed. (${error instanceof Error ? error.message.split('\n')[0] : String(error)})`,
        `node_modules may be partly updated: run "${state.packageManager} install" to settle it, then try again.`,
      );
    }

    // ---- after the install: quick, and part of leaving the app consistent ----------------
    if (rec.jest) {
      const file = path.join(appRoot, 'jest.setup.js');
      const current = await fs.readFile(file, 'utf8').catch(() => null);
      const probe = officialMockProbe(appRoot);
      if (current !== null) {
        const next = rec.jest.regenerate
          ? { changed: true, content: buildJestSetupSource(rec.jest.regenerate, probe) }
          : patchJestSetup(current, { add: rec.jest.add, remove: rec.jest.remove }, probe);
        if (next.changed && next.content !== current) {
          await fs.writeFile(file, next.content, 'utf8');
        } else if (!next.changed && !('already' in next && next.already)) {
          skipped.push({ rule: 'edit', file: 'jest.setup.js', reason: 'couldn’t be edited after the install', manual: 'manual' in next ? next.manual : undefined });
        }
      }
    }

    await pruneEmptyFolders(appRoot, rec.deletions, state.layout.managed);
  } finally {
    process.off('SIGINT', onInterrupt);
  }

  // Stopped once the change was in: it stays in, and what comes after is skipped.
  if (interrupted) {
    logger.warn(
      `Stopped after the install. ${name} is ${adding ? 'added' : 'removed'}; its post-install steps and armemon's checks didn't run — "armemon doctor" checks the wiring.`,
    );
    throw new CancelledError();
  }

  if (adding) {
    for (const step of target.plan.postInstallSteps ?? []) {
      try {
        await withOutputStep(step.label, () =>
          step.run({ appRoot, appName: state.config.appName, platforms: state.platforms, packageManager: state.packageManager }),
        );
      } catch (error) {
        logger.warn(`${step.label} failed. (${error instanceof Error ? error.message.split('\n')[0] : String(error)})`);
        if (step.fallbackNote) postInstallNotes.push(step.fallbackNote);
      }
    }
  }

  if (rec.dependencies.remove.length > 0 || Object.keys({ ...rec.dependencies.add, ...rec.dependencies.addDev }).length > 0) {
    await tryPodInstall(appRoot, state.platforms);
  }

  // ---- R10: check the app still works ---------------------------------------------------
  if (options.verify !== false) {
    verification = await withSpinner('Checking the app still works…', () =>
      verifyGeneratedApp({
        appRoot,
        isTypeScript: state.language === 'typescript',
        hasWeb: state.platforms.includes('web'),
        packageManager: state.packageManager,
        expectations: rec.expectations,
      }),
    );
  }

  const ok = verification?.ok ?? true;
  if (options.json) {
    emit({ ok, ...summary, edited, skipped, [adding ? 'postInstallNotes' : 'removalNotes']: postInstallNotes, verification }, options);
    return;
  }

  logger.success(`${adding ? 'Added' : 'Removed'} ${name}.`);
  for (const file of rec.created) print(`  + ${file}`);
  for (const file of edited) print(`  ~ ${file}`);
  for (const file of rec.deletions) print(`  - ${file}`);
  printOutcome(rec, skipped, postInstallNotes, adding);

  if (verification && !verification.ok) {
    logger.warn("armemon's checks found problems after the change:");
    for (const check of verification.checks.filter((entry) => !entry.ok)) logger.warn(`  ${check.name}: ${check.detail}`);
    logger.info(
      adding
        ? `To undo, run "armemon plugin remove ${target.pluginId}".`
        : `To bring it back, run "armemon plugin add ${target.pluginId}".`,
    );
    process.exitCode = 1;
  } else if (verification) {
    logger.success(`Checked ${verification.checks.map((check) => check.name).join(', ')} — all good.`);
  }
}

function printOutcome(rec: Reconciliation, skipped: Blocker[], planNotes: string[], adding: boolean): void {
  const added = { ...rec.dependencies.add, ...rec.dependencies.addDev };
  if (Object.keys(added).length > 0) {
    print(`  Packages added: ${Object.entries(added).map(([name, version]) => `${name}@${version}`).join(', ')}`);
  }
  if (rec.dependencies.remove.length > 0) print(`  Packages removed: ${rec.dependencies.remove.join(', ')}`);
  for (const { name, reason } of rec.dependencies.kept) print(`  Kept ${name} — ${reason}.`);
  for (const { name, installed, wanted } of rec.dependencies.conflicts) {
    logger.warn(`${name} stays at ${installed}; the plugin was written against ${wanted}.`);
  }
  for (const { file, reason } of rec.kept) print(`  Left in place: ${file} — ${reason}.`);
  if (skipped.length > 0) printBlockers(skipped, 'Left for you to do (--force):');
  for (const note of rec.notes) logger.info(note);
  if (planNotes.length > 0) {
    logger.info(adding ? 'From the plugin:' : 'What removing it leaves to you:');
    for (const note of planNotes) print(`  • ${note}`);
  }
}
