/**
 * FILE: createComponent.ts
 * PATH: packages/cli-armemon/src/commands/createComponent.ts
 *
 * WHAT: `armemon create-component <name>` and `armemon create-hook <name>` — the
 *       command layer for both.
 * WHY:  Two commands over one flow: they differ only in what they validate the name
 *       against and which builder they call, and splitting the flow would mean two
 *       copies of the placement question.
 * HOW:  Thin; runCreateComponentFlow does the work, mirroring createScreen.ts.
 * WHEN: On demand, inside a scaffolded app.
 *
 * EXPORTS: registerCreateComponentCommand, registerCreateHookCommand
 * DEPENDS ON: commander, ../flows/createComponent, ../runCommand
 * USED BY: packages/cli-armemon/src/index.ts
 */

import { Command } from 'commander';
import { runCreateComponentFlow } from '../flows/createComponent.js';
import { runCommand } from '../runCommand.js';

interface CommandOptions {
  dir?: string;
  screen?: string;
  shared?: boolean;
  force?: boolean;
  dryRun?: boolean;
  // No verify: this writes one file nothing imports yet, so there is nothing for
  // armemon's checks to find — and no --no-verify flag to switch them off.
  json?: boolean;
  allAccept?: boolean;
}

function register(program: Command, kind: 'component' | 'hook'): void {
  const isHook = kind === 'hook';

  program
    .command(isHook ? 'create-hook' : 'create-component')
    .argument('[name]', isHook ? 'Hook name — useOrderTotals' : 'Component name — OrderRow')
    .description(
      isHook
        ? 'Create a hook in a screen folder or the shared one (nothing is wired up)'
        : 'Create a component in a screen folder or the shared one (nothing is wired up)',
    )
    .option('--dir <path>', 'The app directory (defaults to the nearest one at or above here)')
    .option('--screen <name>', "Put it in that screen's own folder")
    .option('--shared', 'Put it in the shared folder')
    .option('--force', 'Replace the file if it already exists')
    .option('--dry-run', 'Show what would be created without writing anything')
    .option('--json', 'Print only a JSON summary on stdout (implies --all-accept)')
    .option('--all-accept', 'Take every default instead of asking')
    .addHelpText(
      'after',
      '\nThis creates one file and changes nothing else — no import, no registration.\nThe rule it follows: something lives with the one screen that uses it until a second screen needs it.',
    )
    .action(async (name: string | undefined, options: CommandOptions) => {
      await runCommand(
        () =>
          runCreateComponentFlow({
            kind,
            name,
            cwd: process.cwd(),
            dir: options.dir,
            screen: options.screen,
            shared: options.shared,
            force: options.force,
            dryRun: options.dryRun,
            json: options.json,
            allAccept: options.allAccept,
          }),
        { json: options.json },
      );
    });
}

export function registerCreateComponentCommand(program: Command): void {
  register(program, 'component');
}

export function registerCreateHookCommand(program: Command): void {
  register(program, 'hook');
}
