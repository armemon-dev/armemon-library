/**
 * FILE: renameSlice.ts
 * PATH: packages/cli-armemon/src/commands/renameSlice.ts
 *
 * WHAT: `armemon rename-slice <from> <to>` — the command layer.
 * WHY:  A slice's name lives in five places that have to agree; this is the command
 *       that changes all five at once.
 * HOW:  Thin; runRenameSliceFlow does the work, mirroring renameScreen.ts.
 * WHEN: On demand, inside a scaffolded app.
 *
 * EXPORTS: registerRenameSliceCommand
 * DEPENDS ON: commander, ../flows/renameSlice, ../runCommand
 * USED BY: packages/cli-armemon/src/index.ts
 */

import { Command } from 'commander';
import { runRenameSliceFlow } from '../flows/renameSlice.js';
import { runCommand } from '../runCommand.js';

export function registerRenameSliceCommand(program: Command): void {
  program
    .command('rename-slice')
    .argument('[from]', 'The slice to rename — cart')
    .argument('[to]', 'What to call it — basket')
    .description("Rename a Redux slice: its file, binding, store entry and action prefix")
    .option('--dir <path>', 'The app directory (defaults to the nearest one at or above here)')
    .option('--dry-run', 'Show every change as a diff without writing anything')
    .option('--no-verify', "Skip armemon's checks on the result (they run by default)")
    .option('--json', 'Print only a JSON summary on stdout (implies --all-accept)')
    .option('--all-accept', 'Take every default instead of asking')
    .addHelpText(
      'after',
      '\nAction types are strings, so a dispatch written as { type: \'cart/set\' } cannot be\nrewritten safely — the output names every file that still has one.',
    )
    .action(
      async (
        from: string | undefined,
        to: string | undefined,
        options: {
          dir?: string;
          dryRun?: boolean;
          verify?: boolean;
          json?: boolean;
          allAccept?: boolean;
        },
      ) => {
        await runCommand(
          () =>
            runRenameSliceFlow({
              from,
              to,
              cwd: process.cwd(),
              dir: options.dir,
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
