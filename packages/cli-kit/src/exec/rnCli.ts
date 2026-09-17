/**
 * FILE: rnCli.ts
 * PATH: packages/cli-kit/src/exec/rnCli.ts
 *
 * WHAT: Shells out to the official React Native CLI (`npx @react-native-community/cli
 *       init`) to generate the real native iOS/Android projects for a new app.
 * WHY:  armemon deliberately does not maintain its own native project template — RN's
 *       own tooling is the only thing that reliably stays current with each RN release
 *       (Gradle/AGP versions, Xcode project format, New Architecture defaults, etc.).
 *       This is the single file every later step of `armemon init` depends on being
 *       correct.
 * HOW:  Wraps execa, streams the child process's stdio straight through so the user
 *       sees RN CLI's own progress output, and lets a non-zero exit code throw
 *       (rather than swallowing it) so the init flow aborts with the real error
 *       visible. --skip-install is always passed — armemon controls a single,
 *       batched install later once every plugin's dependencies are known.
 * WHEN: Called once, early, from the init flow's Step 2 — before any armemon-specific
 *       files exist.
 *
 * EXPORTS: shellOutToReactNativeCli, ShellOutToReactNativeCliOptions
 * DEPENDS ON: execa
 * USED BY: packages/cli-armemon/src/flows/initReactNative.ts
 */

import { execa } from 'execa';
import { childStdio } from './childOutput.js';

export interface ShellOutToReactNativeCliOptions {
  appName: string;
  version: string;
  cwd: string;
}

export async function shellOutToReactNativeCli(
  options: ShellOutToReactNativeCliOptions,
): Promise<void> {
  const { appName, version, cwd } = options;

  await execa(
    'npx',
    [
      '@react-native-community/cli',
      'init',
      appName,
      '--version',
      version,
      '--directory',
      appName,
      '--skip-install',
    ],
    {
      cwd,
      stdio: childStdio(),
    },
  );
}
