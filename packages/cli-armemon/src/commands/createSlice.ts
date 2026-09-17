/**
 * FILE: createSlice.ts
 * PATH: packages/cli-armemon/src/commands/createSlice.ts
 *
 * WHAT: `armemon create-slice <name>` — the command layer.
 * WHY:  The generated store.config tells the reader this command exists; without it
 *       that line is a promise the CLI doesn't keep.
 * HOW:  Thin; runCreateSliceFlow does the work, mirroring createScreen.ts.
 * WHEN: On demand, inside a scaffolded app.
 *
 * EXPORTS: registerCreateSliceCommand
 * DEPENDS ON: commander, ../flows/createSlice, ../runCommand
 * USED BY: packages/cli-armemon/src/index.ts
 */

import { Command } from 'commander';
import { runCreateSliceFlow } from '../flows/createSlice.js';
import { runCommand } from '../runCommand.js';

export function registerCreateSliceCommand(program: Command): void {
  program
    .command('create-slice')
    .argument('[name]', 'Slice name — cart, cartSlice, or cart-items')
    .description('Create a Redux slice and register it in your store config')
    .option('--dir <path>', 'The app directory (defaults to the nearest one at or above here)')
    .option('--no-register', "Write the slice file without touching the store config")
    .option('--force', 'Replace the slice file if it already exists')
    .option('--dry-run', 'Show every change as a diff without writing anything')
    .option('--no-verify', "Skip armemon's checks on the result (they run by default)")
    .option('--json', 'Print only a JSON summary on stdout (implies --all-accept)')
    .option('--all-accept', 'Take every default instead of asking')
    .addHelpText(
      'after',
      '\nThe slice file is yours — armemon writes it once and never reads it again.\nExits 1 when an edit had to be skipped or the checks fail.',
    )
    .action(
      async (
        name: string | undefined,
        options: {
          dir?: string;
          register?: boolean;
          force?: boolean;
          dryRun?: boolean;
          verify?: boolean;
          json?: boolean;
          allAccept?: boolean;
        },
      ) => {
        await runCommand(
          () =>
            runCreateSliceFlow({
              name,
              cwd: process.cwd(),
              dir: options.dir,
              register: options.register,
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
