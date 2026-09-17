/**
 * FILE: add.ts
 * PATH: packages/cli-armemon/src/commands/add.ts
 *
 * WHAT: `armemon add <platform>` — adds a platform target to an existing app.
 * WHY:  Platforms were chosen once, at init, and never again. That is wrong for
 *       three ordinary situations: you decide you want web six months in, a
 *       teammate on a Mac wants macOS, and — unavoidably — windows/ can only be
 *       generated on Windows, so somebody has to add it from another machine later.
 * HOW:  Thin command layer; runAddPlatformFlow does the work. The shared options
 *       behave as on every other command: --dir or the nearest app above here,
 *       --dry-run, --no-verify, --json (which implies --all-accept).
 * WHEN: On demand, from inside a scaffolded app.
 *
 * EXPORTS: registerAddCommand
 * DEPENDS ON: commander, ../flows/addPlatform, ../runCommand
 * USED BY: packages/cli-armemon/src/index.ts
 */

import { Command } from 'commander';
import { ALL_PLATFORMS } from '../constants.js';
import { runAddPlatformFlow } from '../flows/addPlatform.js';
import { runCommand } from '../runCommand.js';

export function registerAddCommand(program: Command): void {
  program
    .command('add')
    .argument('<platform>', `Platform to add: ${ALL_PLATFORMS.join(', ')}`)
    .description('Add a platform target to an app you already scaffolded')
    .option('--dir <path>', 'The app directory (defaults to the nearest one at or above here)')
    .option('--dry-run', 'List what adding the platform would do, without changing anything')
    .option('--no-verify', "Skip armemon's checks on the result (they run by default)")
    .option('--json', 'Print only a JSON summary on stdout (implies --all-accept)')
    .option('--all-accept', 'Take every default instead of asking')
    .addHelpText('after', '\nExits 1 when adding fails or the checks find a problem.')
    .action(
      async (
        platform: string,
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
            runAddPlatformFlow({
              platform,
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
