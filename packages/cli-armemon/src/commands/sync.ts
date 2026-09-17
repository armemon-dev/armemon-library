/**
 * FILE: sync.ts
 * PATH: packages/cli-armemon/src/commands/sync.ts
 *
 * WHAT: `armemon sync` — the command layer.
 * WHY:  Every other command re-aligns only the managed files it happens to touch, and
 *       an app scaffolded before the managed zone moved to the app root has no way to
 *       catch up. This is the one that fixes the whole zone.
 * HOW:  Thin; runSyncFlow does the work, mirroring createScreen.ts.
 * WHEN: On demand, inside a scaffolded app.
 *
 * EXPORTS: registerSyncCommand
 * DEPENDS ON: commander, ../flows/sync, ../runCommand
 * USED BY: packages/cli-armemon/src/index.ts
 */

import { Command } from 'commander';
import { runSyncFlow } from '../flows/sync.js';
import { buildCommandReference } from '../commandReference.js';
import { runCommand } from '../runCommand.js';

export function registerSyncCommand(program: Command): void {
  program
    .command('sync')
    .description("Re-align armemon's managed files, and move a legacy src/armemon/ to armemon/")
    .option('--dir <path>', 'The app directory (defaults to the nearest one at or above here)')
    .option('--dry-run', 'Show every change as a diff without writing anything')
    .option('--no-verify', "Skip armemon's checks on the result (they run by default)")
    .option('--json', 'Print only a JSON summary on stdout (implies --all-accept)')
    .option('--all-accept', 'Take every default instead of asking')
    .addHelpText(
      'after',
      '\nSafe to run at any time: it changes formatting and, for an app scaffolded before the move, where the managed files live.\nExits 1 when a file could not be parsed or the checks fail — the output names them.',
    )
    .action(
      async (options: {
        dir?: string;
        dryRun?: boolean;
        verify?: boolean;
        json?: boolean;
        allAccept?: boolean;
      }) => {
        await runCommand(
          () =>
            runSyncFlow({
              // Refreshed on every sync: an app scaffolded months ago would otherwise
              // carry a guide describing a CLI that has moved on.
              commandReference: buildCommandReference(program),
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
