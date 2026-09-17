/**
 * FILE: rnMacosCli.ts
 * PATH: packages/cli-kit/src/exec/rnMacosCli.ts
 *
 * WHAT: Shells out to `react-native-macos-init` to attach a macOS target to the
 *       already-scaffolded RN app.
 * WHY:  Same rationale as rnWindowsCli.ts — macOS is never created by the base RN
 *       CLI scaffold; the official tool bolts a macos/ native folder onto the same
 *       single-package project rather than requiring a separate workspace.
 * HOW:  Flags confirmed live via `npx react-native-macos-init --help`:
 *       `--overwrite` ("Overwrite any existing files without prompting") is
 *       required for the same reason rnWindowsCli.ts needs it — without it, the
 *       tool blocks on an interactive confirmation prompt that never resolves in a
 *       scripted context (confirmed the hard way: it hung indefinitely in this
 *       exact flow before this flag was added). A hard `timeout` is set on the
 *       execa call as defense in depth — even a correctly-flagged external tool
 *       can still hang for other reasons (network, an unexpected prompt this
 *       flag doesn't cover), and the caller's try/catch can only react to a
 *       thrown error, not a process that never exits. Unlike react-native-windows,
 *       this tool self-installs its own react-native-macos dependency (it reads
 *       the app's already-installed react-native version from node_modules and
 *       npm-installs the best-matching react-native-macos release) — so the caller
 *       does NOT need to pre-add react-native-macos to the app's own dependencies.
 *       But that self-install is a hardcoded `npm install` internally, ALWAYS,
 *       regardless of the app's actual chosen package manager, and
 *       react-native-macos pins an EXACT peer react-native patch version that
 *       essentially never matches the app's actual patch — so the caller MUST have
 *       already written `.npmrc`'s `legacy-peer-deps=true` (see npmrcWriter.ts)
 *       before this runs, or the internal npm install hard-fails with ERESOLVE
 *       every time (confirmed live).
 * WHEN: Called once, if 'macos' is in the selected platforms, AFTER the batched
 *       dependency install completes and AFTER writeNpmrcForMacos has run — never
 *       before, since this needs react-native itself already installed in
 *       node_modules to determine a matching react-native-macos version.
 *
 * EXPORTS: shellOutToReactNativeMacosCli
 * DEPENDS ON: execa
 * USED BY: packages/cli-armemon/src/flows/initReactNative.ts
 */

import { execa } from 'execa';
import { childStdio } from './childOutput.js';

export interface ShellOutToReactNativeMacosCliOptions {
  appRoot: string;
}

export async function shellOutToReactNativeMacosCli(
  options: ShellOutToReactNativeMacosCliOptions,
): Promise<void> {
  await execa('npx', ['react-native-macos-init', '--overwrite'], {
    cwd: options.appRoot,
    stdio: childStdio(),
    timeout: 120000,
  });
}
