/**
 * FILE: set.ts
 * PATH: packages/cli-armemon/src/flows/set.ts
 *
 * WHAT: `armemon set <plugin>.<key> <value>` — changes one option in a plugin's
 *       managed config.
 * WHY:  These configs are plain data by design, and editing them by hand is fine.
 *       What is not fine is doing it from a script: every one of them is mostly
 *       commented examples that look exactly like real settings, so sed finds the
 *       wrong line about as often as the right one. This is the same edit, done
 *       through the parser.
 * HOW:  The plugin id picks the file and the exported object — both declared in that
 *       plugin's manifest, under `settings` — and the rest of the dotted
 *       path is followed inside it. A value is coerced to the literal it looks like —
 *       `dark` becomes a string, `18` a number, `true` a boolean — and --raw passes
 *       code through untouched for things like `__DEV__`.
 * WHEN: On demand, inside a scaffolded app.
 *
 * EXPORTS: SetOptions, runSetFlow
 * DEPENDS ON: node:path, @armemon-library/cli-kit, @armemon-library/config-types, ./screenShared
 * USED BY: packages/cli-armemon/src/commands/set.ts
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CliError,
  discoverPlugins,
  discoverProjectPlugins,
  logger,
  setConfigProperty,
} from '@armemon-library/cli-kit';
import { managedPath, type AppLayout } from '@armemon-library/config-types';
import { CATALOG_PACKAGES } from '../constants.js';
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

export interface SetOptions extends ScreenCommandOptions {
  /** `ui.themeMode`, or `essentials.notifications.position`. */
  target?: string;
  value?: string;
  /** Use the value as code rather than inferring a literal from it. */
  raw?: boolean;
  /** Replace a value that is a function or a call. */
  force?: boolean;
}

/** Where the CLI lives, so its own plugins resolve under any package layout. */
const CLI_DIR = path.dirname(fileURLToPath(import.meta.url));

interface SettingsFile {
  file: (layout: AppLayout) => string;
  exportName: string;
}

/**
 * Which file holds which plugin's options, read from each plugin's manifest.
 *
 * This used to be a list kept here and again in the command's help, so a plugin the
 * CLI didn't ship — or one that gained settings later — could never be set, and the
 * two copies were free to disagree. A plugin installed in the app wins over a
 * built-in with the same id, as it does everywhere else.
 */
async function settingsFiles(appRoot: string | null): Promise<Record<string, SettingsFile>> {
  const project = appRoot ? await discoverProjectPlugins(appRoot).catch(() => []) : [];
  const builtIns = await discoverPlugins(CATALOG_PACKAGES, {
    resolveFrom: [...(appRoot ? [appRoot] : []), CLI_DIR],
  }).catch(() => []);

  const found: Record<string, SettingsFile> = {};
  for (const { manifest } of [...builtIns, ...project]) {
    if (!manifest.settings) continue;
    const { file, exportName } = manifest.settings;
    found[manifest.pluginId] = {
      file: (layout) => managedPath(layout, ...file.split('/')),
      exportName,
    };
  }
  return found;
}

/**
 * The value as it should appear in the file.
 *
 * Quoting a string the user typed bare is the whole point — `armemon set ui.themeMode
 * dark` writing `themeMode: dark` would produce a reference to an undeclared name,
 * which type-checks nowhere and is a confusing thing to have to notice.
 */
export function configLiteral(value: string, raw = false): string {
  if (raw) return value;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return value;
  if (['true', 'false', 'null', 'undefined'].includes(value)) return value;
  // Already written as code or a quoted string: leave it exactly as typed.
  if (/^['"`[{]/.test(value)) return value;
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** The config on disk, under whichever extension this app uses. */
async function resolveConfig(appRoot: string, base: string): Promise<string | null> {
  for (const candidate of [base, base.replace(/\.ts$/, '.js')]) {
    if (await pathExists(path.join(appRoot, candidate))) return candidate;
  }
  return null;
}

export async function runSetFlow(options: SetOptions): Promise<void> {
  applyOutputMode(options);

  if (!options.target || options.value === undefined) {
    const known = Object.keys(await settingsFiles(null)).sort().join(', ');
    throw new CliError(
      'Name the option to set, and what to set it to.',
      `e.g. armemon set ui.themeMode dark   (plugins with settings: ${known})`,
    );
  }

  const { appRoot, config: appConfig, layout } = await openApp(options);
  const settings = await settingsFiles(appRoot);
  const known = Object.keys(settings).sort().join(', ');

  const [pluginId, ...rest] = options.target.split('.');
  const key = rest.join('.');
  const config = pluginId ? settings[pluginId] : undefined;

  if (!pluginId || !config || key.length === 0) {
    throw new CliError(
      `"${options.target}" is not an option armemon can set.`,
      `Write it as <plugin>.<option> — e.g. ui.themeMode, essentials.notifications.position. Plugins with settings: ${known}.`,
    );
  }

  const configPath = await resolveConfig(appRoot, config.file(layout));
  if (configPath === null) {
    throw new CliError(
      `This app has no ${pluginId} config.`,
      pluginId in (appConfig.plugins ?? {})
        ? `armemon.config says the ${pluginId} plugin is installed, but ${config.file(layout)} is missing. Restore it from version control.`
        : `This app doesn't have the ${pluginId} plugin, so there is nothing to set. Add it with "armemon plugin add ${pluginId}".`,
    );
  }
  const configFile = path.join(appRoot, configPath);

  const value = configLiteral(options.value, options.raw);
  const changes = new ChangeSet(appRoot);
  await realignManaged(changes, layout, [configFile]);

  const result = await changes.patch(
    configFile,
    (content) =>
      setConfigProperty(content, {
        fileName: configFile,
        exportName: config.exportName,
        key,
        value,
        force: options.force,
      }),
    { action: `set ${key} to ${value}` },
  );

  if (result.conflict) {
    throw new CliError(`Can't set ${options.target}: ${result.reason}.`, result.manual ?? 'Nothing was written.');
  }
  if (result.status === 'skipped') {
    throw new CliError(
      `Can't set ${options.target}: ${result.reason}.`,
      `Nothing was written. ${result.manual ?? ''}`.replace(/\s+/g, ' '),
    );
  }

  if (options.dryRun) {
    printChanges(changes);
    emit({ ok: true, dryRun: true, target: options.target, value }, options);
    return;
  }

  await commit(changes);
  printOutcomes(changes);
  if (result.already) logger.info(`${options.target} was already ${value}.`);

  const touched = changes.outcomes.map((outcome) => outcome.file);
  const verification = await verifyApp(appRoot, appConfig, options);
  printVerification(verification, { touched });

  emit(
    {
      ok: verification?.ok ?? true,
      target: options.target,
      key,
      value,
      file: configPath,
      changed: result.changed,
      verification: verificationSummary(verification, touched),
    },
    options,
  );
}
