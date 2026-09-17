/**
 * FILE: upgrade.ts
 * PATH: packages/cli-armemon/src/flows/upgrade.ts
 *
 * WHAT: `armemon upgrade` — moves an app's @armemon-library/* packages to the versions
 *       published with the CLI running it, installs them, and re-aligns the managed
 *       files and the guide.
 * WHY:  An app depends on `^0.1.0`, and a caret on a 0.x version never reaches 0.2.0 —
 *       so an app stayed on the runtime it was created with however far the CLI
 *       moved, and the only way forward was editing every range by hand and knowing
 *       which versions belong together.
 * HOW:  The target for each package is what the CLI itself depends on, resolved from
 *       the CLI's own folder — the same answer init gives a new app. package.json is
 *       put back if the install fails, so a failed upgrade leaves the app as it was.
 *       `sync` then runs as it would on its own.
 * WHEN: On demand, after updating the CLI.
 *
 * EXPORTS: UpgradeOptions, runUpgradeFlow
 * DEPENDS ON: node:path, node:fs/promises, @armemon-library/cli-kit, ./screenShared, ./sync
 * USED BY: packages/cli-armemon/src/commands/upgrade.ts
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  CliError,
  buildArmemonDependencySpecifier,
  installDependencies,
  isWorkspacePackage,
  logger,
  withOutputStep,
} from '@armemon-library/cli-kit';
import type { PackageManager } from '@armemon-library/config-types';
import { applyOutputMode, emit, openApp, type ScreenCommandOptions } from './screenShared.js';
import { runSyncFlow } from './sync.js';

const CLI_DIR = path.dirname(fileURLToPath(import.meta.url));

export interface UpgradeOptions extends ScreenCommandOptions {
  /** Passed on to sync, which refreshes the guide with it. */
  commandReference?: string;
  /** Where to resolve the CLI's own packages from. Defaults to the CLI's folder; tests point it elsewhere. */
  resolveFrom?: string[];
}

interface Change {
  name: string;
  field: 'dependencies' | 'devDependencies';
  from: string;
  to: string;
}

export async function runUpgradeFlow(options: UpgradeOptions): Promise<void> {
  applyOutputMode(options);

  const { appRoot, config } = await openApp(options);
  const fromCli = { resolveFrom: options.resolveFrom ?? [CLI_DIR] };

  if (isWorkspacePackage('@armemon-library/core', fromCli)) {
    throw new CliError(
      'This armemon runs from its own source checkout, so it has no published versions to upgrade to.',
      'Run `armemon upgrade` from an installed CLI: npx @armemon-library/cli upgrade',
    );
  }

  const packageJsonPath = path.join(appRoot, 'package.json');
  const original = await fs.readFile(packageJsonPath, 'utf8');
  const pkg = JSON.parse(original) as Record<string, Record<string, string> | undefined>;

  const changes: Change[] = [];
  const unknown: string[] = [];
  for (const field of ['dependencies', 'devDependencies'] as const) {
    for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
      if (!name.startsWith('@armemon-library/')) continue;
      const to = buildArmemonDependencySpecifier(name, fromCli);
      // Not a package this CLI ships with, so there is no version to move it to.
      if (to === 'latest') {
        unknown.push(name);
        continue;
      }
      if (to !== spec) changes.push({ name, field, from: spec, to });
    }
  }

  if (unknown.length > 0) {
    logger.warn(`Left alone — this CLI doesn't ship ${unknown.join(', ')}.`);
  }

  if (changes.length === 0) {
    logger.success('Already on the @armemon-library versions this CLI was published with — nothing to upgrade.');
    emit({ ok: true, upgraded: [], unknown }, options);
    return;
  }

  if (!options.json) {
    logger.info(options.dryRun ? 'Upgrading would change:' : 'Upgrading:');
    for (const change of changes) logger.info(`  ${change.name}  ${change.from} → ${change.to}`);
  }

  if (options.dryRun) {
    logger.info('Nothing was changed (--dry-run).');
    emit({ ok: true, dryRun: true, upgraded: changes, unknown }, options);
    return;
  }

  for (const change of changes) pkg[change.field]![change.name] = change.to;
  await fs.writeFile(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

  try {
    await withOutputStep('Installing…', () =>
      installDependencies(appRoot, config.packageManager as PackageManager, { retries: 1 }),
    );
  } catch (error) {
    await fs.writeFile(packageJsonPath, original, 'utf8');
    throw new CliError(
      `The install failed, so package.json was put back and nothing changed. (${error instanceof Error ? error.message.split('\n')[0] : String(error)})`,
      'Fix what the package manager reported above, then run `armemon upgrade` again.',
    );
  }

  logger.success(`Upgraded ${changes.length} package${changes.length === 1 ? '' : 's'}.`);

  // What sync does on its own: re-align the managed files and refresh the guide for
  // this CLI. Its summary is folded into this one, so a script reads a single object.
  let syncOk = true;
  const exitCodeBefore = process.exitCode;
  await runSyncFlow({ ...options, dir: appRoot, json: false });
  if (process.exitCode === 1 && exitCodeBefore !== 1) syncOk = false;

  emit({ ok: syncOk, upgraded: changes, unknown }, options);
}
