/**
 * FILE: plugin.ts
 * PATH: packages/cli-armemon/src/commands/plugin.ts
 *
 * WHAT: `armemon plugin add|remove|list` — the command layer.
 * WHY:  Plugins are one thing with three verbs, so they sit under one command, the way
 *       `link` does. Whatever else an app can gain or lose later gets a group of its own
 *       beside this one rather than more top-level verbs.
 * HOW:  Thin; the flows in flows/plugins do the work. The rulebook they follow is
 *       docs/plugins.md.
 * WHEN: On demand, inside a scaffolded app.
 *
 * EXPORTS: registerPluginCommand
 * DEPENDS ON: commander, ../commandReference, ../flows/plugins/*, ../runCommand
 * USED BY: packages/cli-armemon/src/index.ts
 */

import { Command } from 'commander';
import { buildCommandReference } from '../commandReference.js';
import { runAddPluginFlow } from '../flows/plugins/addPlugin.js';
import { runListPluginsFlow } from '../flows/plugins/listPlugins.js';
import { runRemovePluginFlow } from '../flows/plugins/removePlugin.js';
import { runCommand } from '../runCommand.js';

interface PluginCommandOptions {
  dir?: string;
  dryRun?: boolean;
  verify?: boolean;
  json?: boolean;
  allAccept?: boolean;
  force?: boolean;
  logo?: string;
}

const changing = (command: Command): Command =>
  command
    .option('--dir <path>', 'The app directory (defaults to the nearest one at or above here)')
    .option('--dry-run', 'Show every file, edit and package the change involves, without writing anything')
    .option('--force', "Go ahead past files you've changed, leaving each one as it is and listing it")
    .option('--no-verify', "Skip armemon's checks on the result (they run by default)")
    .option('--json', 'Print only a JSON summary on stdout (implies --all-accept)')
    .option('--all-accept', "Take the plugin's default answers instead of asking")
    .addHelpText(
      'after',
      '\nNothing is written until every change has been worked out. If a file you changed is in\nthe way, nothing changes and armemon says what to do. Exits 1 when the change is blocked,\nfails, or the checks find a problem. The rules: docs/plugins.md.',
    );

export function registerPluginCommand(program: Command): void {
  const plugin = program.command('plugin').description('Add a plugin to this app, or take one out');

  changing(
    plugin
      .command('add')
      .argument('[plugin]', 'Plugin id or package name — redux')
      .description('Add a plugin, wired in exactly as init would have')
      .option('--logo <path>', 'Splash logo image, relative to where you run this'),
  ).action(async (id: string | undefined, options: PluginCommandOptions) => {
    await runCommand(
      () =>
        runAddPluginFlow({
          plugin: id,
          cwd: process.cwd(),
          dir: options.dir,
          dryRun: options.dryRun,
          verify: options.verify,
          json: options.json,
          allAccept: options.allAccept,
          force: options.force,
          logo: options.logo,
          commandReference: buildCommandReference(program),
        }),
      { json: options.json },
    );
  });

  changing(
    plugin
      .command('remove')
      .argument('[plugin]', 'Plugin id or package name — redux')
      .description('Remove a plugin: its files, its packages, and its wiring'),
  ).action(async (id: string | undefined, options: PluginCommandOptions) => {
    await runCommand(
      () =>
        runRemovePluginFlow({
          plugin: id,
          cwd: process.cwd(),
          dir: options.dir,
          dryRun: options.dryRun,
          verify: options.verify,
          json: options.json,
          allAccept: options.allAccept,
          force: options.force,
          commandReference: buildCommandReference(program),
        }),
      { json: options.json },
    );
  });

  plugin
    .command('list')
    .description('List the plugins armemon can install, and which this app has')
    .option('--dir <path>', 'The app directory (defaults to the nearest one at or above here)')
    .option('--json', 'Print only a JSON summary on stdout')
    .action(async (options: { dir?: string; json?: boolean }) => {
      await runCommand(() => runListPluginsFlow({ cwd: process.cwd(), dir: options.dir, json: options.json }), {
        json: options.json,
      });
    });
}
