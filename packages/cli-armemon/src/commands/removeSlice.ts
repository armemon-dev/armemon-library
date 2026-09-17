/**
 * FILE: removeSlice.ts
 * PATH: packages/cli-armemon/src/commands/removeSlice.ts
 *
 * WHAT: `armemon remove-slice <name>` — the command layer.
 * WHY:  create-slice's undo. Without it, taking a slice back out is the same two-file
 *       edit done by hand, with the same half-done failure available.
 * HOW:  Thin; runRemoveSliceFlow does the work, mirroring removeScreen.ts.
 * WHEN: On demand, inside a scaffolded app.
 *
 * EXPORTS: registerRemoveSliceCommand
 * DEPENDS ON: commander, ../flows/removeSlice, ../runCommand
 * USED BY: packages/cli-armemon/src/index.ts
 */

import { Command } from 'commander';
import { runRemoveSliceFlow } from '../flows/removeSlice.js';
import { runCommand } from '../runCommand.js';

export function registerRemoveSliceCommand(program: Command): void {
  program
    .command('remove-slice')
    .argument('[name]', 'Slice name — cart, cartSlice, or cart-items')
    .description('Unregister a Redux slice and delete its file')
    .option('--dir <path>', 'The app directory (defaults to the nearest one at or above here)')
    .option('--keep-files', 'Unregister it but leave the slice file where it is')
    .option('--force', 'Remove it even though other files still import it')
    .option('--dry-run', 'Show every change as a diff without writing anything')
    .option('--no-verify', "Skip armemon's checks on the result (they run by default)")
    .option('--json', 'Print only a JSON summary on stdout (implies --all-accept)')
    .option('--all-accept', 'Take every default instead of asking')
    .addHelpText(
      'after',
      '\nRefuses while another file still imports the slice, since that import would be left pointing at nothing.',
    )
    .action(
      async (
        name: string | undefined,
        options: {
          dir?: string;
          keepFiles?: boolean;
          force?: boolean;
          dryRun?: boolean;
          verify?: boolean;
          json?: boolean;
          allAccept?: boolean;
        },
      ) => {
        await runCommand(
          () =>
            runRemoveSliceFlow({
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
