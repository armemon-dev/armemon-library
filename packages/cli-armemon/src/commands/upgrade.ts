/**
 * FILE: upgrade.ts
 * PATH: packages/cli-armemon/src/commands/upgrade.ts
 *
 * WHAT: `armemon upgrade` — the command layer.
 * WHY:  Moving an app to a newer CLI's packages is several steps that have to agree
 *       with each other; see flows/upgrade.ts.
 * HOW:  Thin: parses options, builds the command reference sync refreshes the guide
 *       with, and hands off to runUpgradeFlow.
 * WHEN: On demand, after updating the CLI.
 *
 * EXPORTS: registerUpgradeCommand
 * DEPENDS ON: commander, ../flows/upgrade, ../commandReference, ../runCommand
 * USED BY: packages/cli-armemon/src/index.ts
 */

import { Command } from 'commander';
import { runUpgradeFlow } from '../flows/upgrade.js';
import { buildCommandReference } from '../commandReference.js';
import { runCommand } from '../runCommand.js';

export function registerUpgradeCommand(program: Command): void {
  program
    .command('upgrade')
    .description("Move the app's @armemon-library packages to this CLI's versions, then sync")
    .option('--dir <path>', 'The app directory (defaults to the nearest one at or above here)')
    .option('--dry-run', 'List the version changes without installing anything')
    .option('--no-verify', "Skip armemon's checks on the result (they run by default)")
    .option('--json', 'Print only a JSON summary on stdout (implies --all-accept)')
    .option('--all-accept', 'Take every default instead of asking')
    .addHelpText(
      'after',
      '\nUpdate the CLI first (npm install -g @armemon-library/cli), then run this inside the app.\nIf the install fails, package.json is put back and nothing changes.',
    )
    .action(
      async (options: { dir?: string; dryRun?: boolean; verify?: boolean; json?: boolean; allAccept?: boolean }) => {
        await runCommand(
          () =>
            runUpgradeFlow({
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
