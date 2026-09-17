/**
 * FILE: createScreen.ts
 * PATH: packages/cli-armemon/src/commands/createScreen.ts
 *
 * WHAT: `armemon create-screen <name>` — the command layer.
 * WHY:  Screens are the unit people add most often, and the one armemon had no
 *       answer for: init created some and then you were on your own.
 * HOW:  Thin; runCreateScreenFlow does the work, mirroring add.ts / addPlatform.ts.
 *       `--register` and `--no-register` are both declared so that neither leaves the
 *       option undefined — which the flow reads as "ask".
 * WHEN: On demand, inside a scaffolded app.
 *
 * EXPORTS: registerCreateScreenCommand
 * DEPENDS ON: commander, ../flows/createScreen, ../runCommand
 * USED BY: packages/cli-armemon/src/index.ts
 */

import { Command } from 'commander';
import { runCreateScreenFlow } from '../flows/createScreen.js';
import { runCommand } from '../runCommand.js';

export function registerCreateScreenCommand(program: Command): void {
  program
    .command('create-screen')
    .argument('[name]', 'Screen name — Order, OrderScreen, or order-history')
    .description('Create a screen and register it in your navigator, param list and deep links')
    .option('--dir <path>', 'The app directory (defaults to the nearest one at or above here)')
    .option('--full', 'Create components/, hooks/, utils/ and assets/ folders')
    .option('--flat', 'Create only index — no subfolders')
    .option('--register', 'Register without asking; fail if there is no navigator')
    .option('--no-register', "Don't touch the navigator")
    .option('--navigator <name>', 'Where to register: stack, tabs, drawer, a variable like Tab, or File:Variable')
    .option('--link <path>', 'Deep-link path, e.g. order or order/:id')
    .option('--no-link', "Don't add a deep-link entry")
    .option('--params <list>', 'Route params, e.g. "id:string,page?:number" (string, number, boolean)')
    .option('--initial', "Make it the navigator's initial route")
    .option('--modal', 'Present it as a modal (stack navigators)')
    .option('--title <title>', 'Header / tab title')
    .option('--force', 'Replace the screen if it already exists')
    .option('--dry-run', 'Show every change as a diff without writing anything')
    .option('--no-verify', "Skip armemon's checks on the result (they run by default)")
    .option('--json', 'Print only a JSON summary on stdout (implies --all-accept)')
    .option('--all-accept', 'Take every default instead of asking')
    .addHelpText(
      'after',
      '\nExits 1 when an edit had to be skipped or the checks fail — the output says what to add by hand.',
    )
    .action(
      async (
        name: string | undefined,
        options: {
          dir?: string;
          full?: boolean;
          flat?: boolean;
          register?: boolean;
          navigator?: string;
          link?: string | boolean;
          params?: string;
          initial?: boolean;
          modal?: boolean;
          title?: string;
          force?: boolean;
          dryRun?: boolean;
          verify?: boolean;
          json?: boolean;
          allAccept?: boolean;
        },
      ) => {
        await runCommand(
          () =>
            runCreateScreenFlow({
              name,
              cwd: process.cwd(),
              dir: options.dir,
              full: options.full,
              flat: options.flat,
              register: options.register,
              navigator: options.navigator,
              link: typeof options.link === 'string' ? options.link : undefined,
              noLink: options.link === false,
              params: options.params,
              initial: options.initial,
              modal: options.modal,
              title: options.title,
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
