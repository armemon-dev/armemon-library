/**
 * FILE: removeScreen.ts
 * PATH: packages/cli-armemon/src/commands/removeScreen.ts
 *
 * WHAT: `armemon remove-screen <name>` — the command layer.
 * WHY:  create-screen's inverse. Without it, removing a screen is the same four
 *       forgettable edits, and the stale ones only fail when someone taps a link.
 * HOW:  Thin; runRemoveScreenFlow does the work.
 * WHEN: On demand, inside a scaffolded app.
 *
 * EXPORTS: registerRemoveScreenCommand
 * DEPENDS ON: commander, ../flows/removeScreen, ../runCommand
 * USED BY: packages/cli-armemon/src/index.ts
 */

import { Command } from 'commander';
import { runRemoveScreenFlow } from '../flows/removeScreen.js';
import { runCommand } from '../runCommand.js';

export function registerRemoveScreenCommand(program: Command): void {
  program
    .command('remove-screen')
    .argument('<name>', 'Screen name — Order, OrderScreen, or order-history')
    .description('Remove a screen: unregister it, drop its types and deep link, delete its folder')
    .option('--dir <path>', 'The app directory (defaults to the nearest one at or above here)')
    .option('--keep-files', 'Unregister it but keep its folder')
    .option('--force', 'Remove it even while code still navigates to it, or it is an initial route')
    .option('--dry-run', 'Show every change as a diff without writing anything')
    .option('--no-verify', "Skip armemon's checks on the result (they run by default)")
    .option('--json', 'Print only a JSON summary on stdout (implies --all-accept)')
    .option('--all-accept', 'Take every default instead of asking')
    .addHelpText('after', '\nRefuses while other code still uses the route, and lists where. Exits 1 on any skipped edit or failed check.')
    .action(
      async (
        name: string,
        options: { dir?: string; keepFiles?: boolean; force?: boolean; dryRun?: boolean; verify?: boolean; json?: boolean; allAccept?: boolean },
      ) => {
        await runCommand(
          () =>
            runRemoveScreenFlow({
              name,
              cwd: process.cwd(),
              dir: options.dir,
              keepFiles: options.keepFiles,
              force: options.force,
              dryRun: options.dryRun,
              verify: options.verify,
              json: options.json,
              allAccept: options.allAccept,
            }),
          { json: options.json },
        );
      },
    );
}
