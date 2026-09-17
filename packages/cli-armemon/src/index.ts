/**
 * FILE: index.ts
 * PATH: packages/cli-armemon/src/index.ts
 *
 * WHAT: Builds the commander Command program for the armemon CLI and exposes it as
 *       createProgram() — the factory bin/armemon.ts invokes, under either of the
 *       package's command names (`armemon`, `memon`).
 * WHY:  Exporting a factory (rather than parsing argv as a side effect of importing
 *       this module) lets the bin rename the program for the command that was typed,
 *       and lets the user-guide generator read every command and flag without running
 *       any of them.
 * HOW:  Instantiates a commander.Command, sets name/description/version, registers
 *       each command module.
 * WHEN: Called once per CLI invocation by bin/armemon.ts, and by
 *       scripts/generate-user-guide.mjs.
 *
 * EXPORTS: createProgram, runCreateScreenFlow, runRemoveScreenFlow, runRenameScreenFlow,
 *          renamedLinkPath, ChangeSet, commit, lineDiff
 * DEPENDS ON: commander, ./commands/{init,add,createScreen,removeScreen,renameScreen,list,doctor}, ./version
 * USED BY: packages/cli-armemon/bin/armemon.ts, scripts/generate-user-guide.mjs
 */

import { Command } from 'commander';
import { registerInitCommand } from './commands/init.js';
import { registerAddCommand } from './commands/add.js';
import { registerCreateScreenCommand } from './commands/createScreen.js';
import { registerRemoveScreenCommand } from './commands/removeScreen.js';
import { registerRenameScreenCommand } from './commands/renameScreen.js';
import { registerListCommand } from './commands/list.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerSyncCommand } from './commands/sync.js';
import { registerUpgradeCommand } from './commands/upgrade.js';
import { registerCreateSliceCommand } from './commands/createSlice.js';
import {
  registerCreateComponentCommand,
  registerCreateHookCommand,
} from './commands/createComponent.js';
import { registerRemoveSliceCommand } from './commands/removeSlice.js';
import { registerRenameSliceCommand } from './commands/renameSlice.js';
import { registerLinkCommand } from './commands/link.js';
import { registerSetCommand } from './commands/set.js';
import { registerPluginCommand } from './commands/plugin.js';
import { getCliVersion } from './version.js';
import { writeJson } from './jsonOutput.js';

/**
 * Exported so the regression suite can drive it against a real app on disk. The
 * command layer is a thin wrapper; the behaviour worth testing is all in here.
 */
export { runCreateScreenFlow } from './flows/createScreen.js';
export { runRemoveScreenFlow } from './flows/removeScreen.js';
export { runRenameScreenFlow, renamedLinkPath } from './flows/renameScreen.js';
export { runSyncFlow } from './flows/sync.js';
export { runUpgradeFlow } from './flows/upgrade.js';
export { runCreateSliceFlow } from './flows/createSlice.js';
export { runCreateComponentFlow } from './flows/createComponent.js';
export { runRemoveSliceFlow } from './flows/removeSlice.js';
export { runRenameSliceFlow } from './flows/renameSlice.js';
export { runLinkFlow } from './flows/link.js';
export { runAddPlatformFlow } from './flows/addPlatform.js';
export { runSetFlow, configLiteral } from './flows/set.js';
export { runAddPluginFlow } from './flows/plugins/addPlugin.js';
export { runRemovePluginFlow } from './flows/plugins/removePlugin.js';
export { runListPluginsFlow } from './flows/plugins/listPlugins.js';
// Generated from the live program, so the in-app guide cannot drift from the CLI.
export { buildCommandReference } from './commandReference.js';
export { buildRepoUserGuide, buildCliReadme } from './userGuide.js';
// The all-or-nothing writer, so the suite can make a write fail and watch it undo.
export { ChangeSet, commit, lineDiff } from './flows/screenShared.js';
// Exported for the suite: these are written outside any plugin plan, so the
// generated-code guards cannot otherwise see them.
export { sharedReadme, sharedFolderReadme, examplesReadme } from './flows/initReactNative.js';
export type { CreateScreenOptions } from './flows/createScreen.js';
export type { RemoveScreenOptions } from './flows/removeScreen.js';
export type { RenameScreenOptions } from './flows/renameScreen.js';
export type { SyncOptions } from './flows/sync.js';
export type { UpgradeOptions } from './flows/upgrade.js';
export type { CreateSliceOptions } from './flows/createSlice.js';
export type { CreateComponentOptions } from './flows/createComponent.js';
export type { RemoveSliceOptions } from './flows/removeSlice.js';
export type { RenameSliceOptions } from './flows/renameSlice.js';
export type { LinkOptions } from './flows/link.js';
export type { SetOptions } from './flows/set.js';
export type { AddPluginOptions } from './flows/plugins/addPlugin.js';
export type { RemovePluginOptions } from './flows/plugins/removePlugin.js';

/**
 * Whether `--json` was passed as a flag — not as the value of another option.
 *
 * `argv.includes('--json')` also matched `create-screen Order --title --json`, where
 * `--json` is the title, and switched commander's errors to JSON for a person reading
 * a terminal. So the arguments are walked the way commander reads them: an option
 * that takes a value consumes the next argument.
 */
function asksForJson(argv: readonly string[], program: Command): boolean {
  const takesValue = new Set<string>();
  const collect = (command: Command) => {
    for (const option of command.options) {
      if (!option.required && !option.optional) continue;
      if (option.long) takesValue.add(option.long);
      if (option.short) takesValue.add(option.short);
    }
    command.commands.forEach(collect);
  };
  collect(program);

  for (let index = 2; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === '--') return false;
    if (argument === '--json') return true;
    if (takesValue.has(argument)) index += 1;
  }
  return false;
}

/** Applied to every command, since settings only pass to commands created after them. */
function everyCommand(command: Command, apply: (command: Command) => void): void {
  apply(command);
  for (const child of command.commands) everyCommand(child, apply);
}

export function createProgram(argv: readonly string[] = process.argv): Command {
  const program = new Command();

  program
    .name('armemon')
    .description('Interactive scaffolding CLI for React Native apps')
    // Read from package.json, not hardcoded: a version string that drifts the moment
    // changesets bumps the package makes every bug report's version line a guess.
    .version(getCliVersion());

  registerInitCommand(program);
  registerAddCommand(program);
  registerCreateScreenCommand(program);
  registerRemoveScreenCommand(program);
  registerRenameScreenCommand(program);
  registerPluginCommand(program);
  registerListCommand(program);
  registerDoctorCommand(program);
  registerSyncCommand(program);
  registerUpgradeCommand(program);
  registerCreateSliceCommand(program);
  registerRemoveSliceCommand(program);
  registerRenameSliceCommand(program);
  registerLinkCommand(program);
  registerSetCommand(program);
  registerCreateComponentCommand(program);
  registerCreateHookCommand(program);

  // After registering, because deciding needs to know which options take a value.
  if (asksForJson(argv, program)) {
    // A script asked for JSON, so commander's own errors — an unknown option, a
    // missing argument — have to be JSON on stdout too, or `--json | jq` breaks on the
    // failure it most needs to report.
    everyCommand(program, (command) =>
      command.configureOutput({
        outputError: (message) => {
          writeJson({ ok: false, error: { message: message.replace(/^error:\s*/i, '').trim() } });
        },
      }),
    );
  } else {
    everyCommand(program, (command) => command.showHelpAfterError());
  }

  return program;
}
