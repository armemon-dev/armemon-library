/**
 * FILE: renameScreen.ts
 * PATH: packages/cli-armemon/src/commands/renameScreen.ts
 *
 * WHAT: `armemon rename-screen <from> <to>` — the command layer.
 * WHY:  A rename touches the folder, the component, every navigator and param list,
 *       the deep link and every navigate() call; missing one fails at runtime.
 * HOW:  Thin; runRenameScreenFlow does the work.
 * WHEN: On demand, inside a scaffolded app.
 *
 * EXPORTS: registerRenameScreenCommand
 * DEPENDS ON: commander, ../flows/renameScreen, ../runCommand
 * USED BY: packages/cli-armemon/src/index.ts
 */

import { Command } from 'commander';
import { runRenameScreenFlow } from '../flows/renameScreen.js';
import { runCommand } from '../runCommand.js';

export function registerRenameScreenCommand(program: Command): void {
  program
    .command('rename-screen')
    .argument('<from>', 'The screen to rename — Order, OrderScreen, or order')
    .argument('<to>', 'Its new name')
    .description('Rename a screen everywhere: folder, component, route, types, deep link and navigate() calls')
    .option('--dir <path>', 'The app directory (defaults to the nearest one at or above here)')
    .option('--link <path>', 'A new deep-link path')
    .option('--keep-link', 'Keep the current deep-link path even if it came from the old name')
    .option('--dry-run', 'Show every change as a diff without writing anything')
    .option('--no-verify', "Skip armemon's checks on the result (they run by default)")
    .option('--json', 'Print only a JSON summary on stdout (implies --all-accept)')
    .option('--all-accept', 'Take every default instead of asking')
    .addHelpText('after', '\nPlain mentions of the old name (a title, a log line) are listed, not rewritten. Exits 1 on any skipped edit or failed check.')
    .action(
      async (
        from: string,
        to: string,
        options: { dir?: string; link?: string; keepLink?: boolean; dryRun?: boolean; verify?: boolean; json?: boolean; allAccept?: boolean },
      ) => {
        await runCommand(
          () =>
            runRenameScreenFlow({
              from,
              to,
              cwd: process.cwd(),
              dir: options.dir,
              link: options.link,
              keepLink: options.keepLink,
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
