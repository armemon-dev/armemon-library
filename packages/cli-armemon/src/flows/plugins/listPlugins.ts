/**
 * FILE: listPlugins.ts
 * PATH: packages/cli-armemon/src/flows/plugins/listPlugins.ts
 *
 * WHAT: `armemon plugin list` (and `armemon list`) — every plugin armemon can install,
 *       and, inside an app, which of them it has.
 * WHY:  The two questions someone asks before `plugin add` or `plugin remove`: what is
 *       there, and what do I already have. Outside an app it is the catalog `init`
 *       offers, plus any plugin the folder itself depends on.
 * HOW:  Finds the app at or above the folder (or --dir); lists the same catalog the
 *       plugin commands resolve against, so a name shown here is a name they accept.
 * WHEN: On demand.
 *
 * EXPORTS: runListPluginsFlow, ListPluginsOptions
 * DEPENDS ON: node:path, chalk, @armemon-library/cli-kit, ../../constants, ../../jsonOutput,
 *             ./appState
 * USED BY: packages/cli-armemon/src/commands/plugin.ts, packages/cli-armemon/src/commands/list.ts
 */

import path from 'node:path';
import chalk from 'chalk';
import {
  discoverPlugins,
  discoverProjectPlugins,
  findAppRoot,
  readAppConfig,
  type DiscoveredPlugin,
} from '@armemon-library/cli-kit';
import { CATALOG_PACKAGES } from '../../constants.js';
import { writeJson } from '../../jsonOutput.js';
import { CLI_DIR, discoverCatalog } from './appState.js';

export interface ListPluginsOptions {
  cwd: string;
  dir?: string;
  json?: boolean;
}

export async function runListPluginsFlow(options: ListPluginsOptions): Promise<void> {
  const start = path.resolve(options.cwd, options.dir ?? '.');
  const appRoot = options.dir ? start : await findAppRoot(start);
  const config = appRoot ? await readAppConfig(appRoot).catch(() => null) : null;

  let plugins: DiscoveredPlugin[];
  if (appRoot && config) {
    plugins = await discoverCatalog(appRoot);
  } else {
    const builtIns = await discoverPlugins(CATALOG_PACKAGES, { resolveFrom: [options.cwd, CLI_DIR] });
    const project = (await discoverProjectPlugins(options.cwd)).filter(
      (plugin) => !builtIns.some((builtIn) => builtIn.manifest.pluginId === plugin.manifest.pluginId),
    );
    plugins = [...builtIns, ...project];
  }
  const installed = (plugin: DiscoveredPlugin) => (config ? plugin.manifest.pluginId in config.plugins : undefined);

  if (options.json) {
    writeJson({
      ok: true,
      app: appRoot && config ? appRoot : null,
      plugins: plugins.map((plugin) => ({
        pluginId: plugin.manifest.pluginId,
        packageName: plugin.packageName,
        displayName: plugin.manifest.displayName,
        description: plugin.manifest.description,
        category: plugin.manifest.category,
        required: plugin.manifest.required,
        source: plugin.packageName.startsWith('@armemon-library/') ? 'built-in' : 'project',
        platforms: plugin.manifest.platforms ?? 'all',
        dependsOn: plugin.manifest.dependsOn ?? [],
        settings: plugin.manifest.settings ?? null,
        ...(config ? { installed: installed(plugin) } : {}),
      })),
    });
    return;
  }

  for (const plugin of plugins) {
    const { manifest, packageName } = plugin;
    const badges = [
      installed(plugin) ? chalk.green('installed') : null,
      manifest.required ? chalk.cyan('core') : null,
      packageName.startsWith('@armemon-library/') ? null : chalk.magenta('from this project'),
      manifest.platforms ? chalk.dim(manifest.platforms.join('/')) : null,
      manifest.dependsOn?.length ? chalk.dim(`after ${manifest.dependsOn.join(', ')}`) : null,
      manifest.settings ? chalk.dim(`armemon set ${manifest.pluginId}.<option>`) : null,
    ].filter(Boolean);

    process.stdout.write(
      `${chalk.bold(manifest.pluginId.padEnd(14))}${manifest.displayName}${
        badges.length > 0 ? `  ${badges.join(' · ')}` : ''
      }\n  ${chalk.dim(manifest.description)}\n\n`,
    );
  }

  process.stdout.write(
    chalk.dim(
      config
        ? 'Add one: armemon plugin add <id>  ·  remove one: armemon plugin remove <id>\n'
        : 'Use with: armemon init react-native MyApp --plugins redux,navigation — or, inside an app, armemon plugin add <id>\n',
    ),
  );
}
