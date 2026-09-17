/**
 * FILE: list.ts
 * PATH: packages/cli-armemon/src/commands/list.ts
 *
 * WHAT: `armemon list` — prints the available plugins with their ids, descriptions
 *       and platform support.
 * WHY:  --plugins takes plugin ids, and there was no way to discover what those ids
 *       are short of reading the source. The reference CLI this replaced had a
 *       `list` command; this restores it, now backed by real manifests rather than a
 *       hardcoded string table, so a third-party plugin installed in the current
 *       project shows up too.
 * HOW:  The same listing as `armemon plugin list` — inside an app it also marks which
 *       plugins the app has — kept under its old name for scripts that use it.
 * WHEN: On demand.
 *
 * EXPORTS: registerListCommand
 * DEPENDS ON: commander, ../flows/plugins/listPlugins, ../runCommand
 * USED BY: packages/cli-armemon/src/index.ts
 */

import { Command } from 'commander';
import { runListPluginsFlow } from '../flows/plugins/listPlugins.js';
import { runCommand } from '../runCommand.js';

export function registerListCommand(program: Command): void {
  program
    .command('list')
    .description('List the plugins armemon can install (the same as armemon plugin list)')
    .option('--dir <path>', 'The app directory (defaults to the nearest one at or above here)')
    .option('--json', 'Emit machine-readable JSON instead of prose')
    .action(async (options: { dir?: string; json?: boolean }) => {
      await runCommand(() => runListPluginsFlow({ cwd: process.cwd(), dir: options.dir, json: options.json }), {
        json: options.json,
      });
    });
}
