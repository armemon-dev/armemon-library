/**
 * FILE: set.ts
 * PATH: packages/cli-armemon/src/commands/set.ts
 *
 * WHAT: `armemon set <plugin>.<option> <value>` — the command layer.
 * WHY:  Editing these configs by hand is expected and fine; doing it from a script is
 *       what needed a command, since the files are mostly commented examples that a
 *       text tool cannot tell from real settings.
 * HOW:  Thin; runSetFlow does the work.
 * WHEN: On demand, inside a scaffolded app.
 *
 * EXPORTS: registerSetCommand
 * DEPENDS ON: commander, ../flows/set, ../runCommand
 * USED BY: packages/cli-armemon/src/index.ts
 */

import { Command } from 'commander';
import { runSetFlow } from '../flows/set.js';
import { runCommand } from '../runCommand.js';

export function registerSetCommand(program: Command): void {
  program
    .command('set')
    .argument('[option]', 'Plugin option — ui.themeMode, essentials.notifications.position')
    .argument('[value]', 'The value — dark, 18, true')
    .description("Set one option in a plugin's config")
    .option('--dir <path>', 'The app directory (defaults to the nearest one at or above here)')
    .option('--raw', 'Use the value as code rather than inferring a literal (e.g. __DEV__)')
    .option('--force', 'Replace a value that is a function or a call')
    .option('--dry-run', 'Show the change as a diff without writing anything')
    .option('--no-verify', "Skip armemon's checks on the result (they run by default)")
    .option('--json', 'Print only a JSON summary on stdout (implies --all-accept)')
    .option('--all-accept', 'Take every default instead of asking')
    .addHelpText(
      'after',
      '\nValues are coerced to what they look like: dark becomes a string, 18 a number,\ntrue a boolean. Pass --raw to write an expression instead.\n\nAny plugin that declares settings in its manifest can be set — armemon list shows which.',
    )
    .action(
      async (
        option: string | undefined,
        value: string | undefined,
        options: {
          dir?: string;
          raw?: boolean;
          force?: boolean;
          dryRun?: boolean;
          verify?: boolean;
          json?: boolean;
          allAccept?: boolean;
        },
      ) => {
        await runCommand(
          () =>
            runSetFlow({
              target: option,
              value,
              raw: options.raw,
              force: options.force,
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
