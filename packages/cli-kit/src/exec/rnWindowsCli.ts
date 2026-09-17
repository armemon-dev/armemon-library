/**
 * FILE: rnWindowsCli.ts
 * PATH: packages/cli-kit/src/exec/rnWindowsCli.ts
 *
 * WHAT: Shells out to `react-native init-windows` to attach a Windows target to the
 *       already-scaffolded RN app.
 * WHY:  Unlike iOS/Android, Windows is never created by the base RN CLI scaffold —
 *       Microsoft's own tooling attaches a windows/ native folder (plus
 *       platform-suffixed JS file support) to the SAME single-package project
 *       rather than requiring a separate workspace, confirmed by design (Windows
 *       tooling expects to bolt onto an existing project, not create its own).
 * HOW:  `init-windows` is NOT a base react-native CLI command — it's a subcommand
 *       contributed by react-native-windows' own CLI plugin, only registered once
 *       that package is actually installed (confirmed live: `react-native --help`
 *       inside a project without react-native-windows doesn't list it at all, and
 *       running it anyway either no-ops or hangs trying to npx-resolve it
 *       interactively). So the caller MUST add react-native-windows to the app's
 *       dependencies and run the batched install BEFORE this function is called —
 *       this function only runs the (now-available) init-windows subcommand itself,
 *       it does not install anything. `--overwrite` keeps this fully non-interactive.
 *       A hard `timeout` is set as defense in depth against any other unexpected
 *       prompt this flag doesn't cover.
 * WHEN: Called once, if 'windows' is in the selected platforms, AFTER the batched
 *       dependency install (which must include react-native-windows) completes —
 *       never before, unlike the platform-cleanup/scaffolding steps that run early.
 *
 * EXPORTS: shellOutToReactNativeWindowsCli
 * DEPENDS ON: execa
 * USED BY: packages/cli-armemon/src/flows/initReactNative.ts, flows/addPlatform.ts
 */

import { execa } from 'execa';
import { childStdio } from './childOutput.js';

export interface ShellOutToReactNativeWindowsCliOptions {
  appRoot: string;
}

export async function shellOutToReactNativeWindowsCli(
  options: ShellOutToReactNativeWindowsCliOptions,
): Promise<void> {
  await execa('npx', ['react-native', 'init-windows', '--overwrite'], {
    cwd: options.appRoot,
    stdio: childStdio(),
    timeout: 120000,
  });
}
