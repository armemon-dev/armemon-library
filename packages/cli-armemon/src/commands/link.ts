/**
 * FILE: link.ts
 * PATH: packages/cli-armemon/src/commands/link.ts
 *
 * WHAT: `armemon link list|add|remove` — the command layer.
 * WHY:  Three verbs on one thing, so they live under one command rather than as three
 *       top-level ones.
 * HOW:  Thin; runLinkFlow does the work.
 * WHEN: On demand, inside a scaffolded app.
 *
 * EXPORTS: registerLinkCommand
 * DEPENDS ON: commander, ../flows/link, ../runCommand
 * USED BY: packages/cli-armemon/src/index.ts
 */

import { Command } from 'commander';
import { runLinkFlow } from '../flows/link.js';
import { runCommand } from '../runCommand.js';

interface LinkCommandOptions {
  dir?: string;
  dryRun?: boolean;
  json?: boolean;
  allAccept?: boolean;
}

const shared = (command: Command): Command =>
  command
    .option('--dir <path>', 'The app directory (defaults to the nearest one at or above here)')
    .option('--json', 'Print only a JSON summary on stdout')
    .option('--all-accept', 'Take every default instead of asking');

export function registerLinkCommand(program: Command): void {
  const link = program
    .command('link')
    .description("Read and edit the app's deep links")
    .addHelpText(
      'after',
      '\nA link for a screen inside a nested navigator has to be nested too, or it resolves\nto a route the root navigator does not have and opens nothing. add does that for you.',
    );

  shared(
    link
      .command('init')
      .description('Create a deep-link config covering every screen this app already has')
      .option('--dry-run', 'Show what would be created without writing anything'),
  ).action(async (options: LinkCommandOptions) => {
    await runCommand(
      () =>
        runLinkFlow({
          action: 'init',
          cwd: process.cwd(),
          dir: options.dir,
          dryRun: options.dryRun,
          json: options.json,
          allAccept: options.allAccept,
        }),
      { json: options.json },
    );
  });

  shared(link.command('list').description('Show every deep link, and where each one sits')).action(
    async (options: LinkCommandOptions) => {
      await runCommand(
        () => runLinkFlow({ action: 'list', cwd: process.cwd(), dir: options.dir, json: options.json, allAccept: options.allAccept }),
        { json: options.json },
      );
    },
  );

  shared(
    link
      .command('add')
      .argument('[route]', 'Route name — Order')
      .argument('[path]', 'URL path — order/:id')
      .description('Add or update a deep link, nested under the right navigator')
      .option('--dry-run', 'Show the change as a diff without writing anything'),
  ).action(async (route: string | undefined, linkPath: string | undefined, options: LinkCommandOptions) => {
    await runCommand(
      () =>
        runLinkFlow({
          action: 'add',
          route,
          linkPath,
          cwd: process.cwd(),
          dir: options.dir,
          dryRun: options.dryRun,
          json: options.json,
          allAccept: options.allAccept,
        }),
      { json: options.json },
    );
  });

  shared(
    link
      .command('remove')
      .argument('[route]', 'Route name — Order')
      .description('Remove a deep link')
      .option('--dry-run', 'Show the change as a diff without writing anything'),
  ).action(async (route: string | undefined, options: LinkCommandOptions) => {
    await runCommand(
      () =>
        runLinkFlow({
          action: 'remove',
          route,
          cwd: process.cwd(),
          dir: options.dir,
          dryRun: options.dryRun,
          json: options.json,
          allAccept: options.allAccept,
        }),
      { json: options.json },
    );
  });
}
