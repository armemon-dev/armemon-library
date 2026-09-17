/**
 * FILE: pods.ts
 * PATH: packages/cli-armemon/src/flows/pods.ts
 *
 * WHAT: Runs `pod install` for an app's iOS project, when there is one and this is a Mac.
 * WHY:  init, `plugin add` and `plugin remove` all change native dependencies, and an
 *       iOS build with stale pods fails with an error that doesn't name the cause.
 *       One copy, so the three never disagree about how it is run.
 * HOW:  `bundle exec pod install` when the template's Gemfile is ready, plain
 *       `pod install` otherwise. A failure warns with the exact command to re-run;
 *       it never fails the command that asked.
 * WHEN: After a dependency install that may have changed native modules.
 *
 * EXPORTS: tryPodInstall
 * DEPENDS ON: node:path, node:fs/promises, execa, @armemon-library/cli-kit
 * USED BY: flows/initReactNative.ts, flows/plugins/transaction.ts
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { execa } from 'execa';
import { childStdio, logger, withOutputStep } from '@armemon-library/cli-kit';
import type { Platform } from '@armemon-library/config-types';

export async function tryPodInstall(appRoot: string, platforms: Platform[]): Promise<void> {
  if (!platforms.includes('ios') || process.platform !== 'darwin') return;

  const iosDir = path.join(appRoot, 'ios');
  const hasIosDir = await fs
    .stat(iosDir)
    .then((stat) => stat.isDirectory())
    .catch(() => false);
  if (!hasIosDir) return;

  // The RN template ships a Gemfile pinning CocoaPods, so `bundle exec pod` uses the
  // version the project expects; bare `pod` uses whatever is on PATH. Which one to
  // run is decided up front with `bundle check`: trying bundle and falling back on
  // ANY failure ran a genuine CocoaPods failure a second time, minutes later, just to
  // print the same error again.
  const hasGemfile = await fs
    .access(path.join(appRoot, 'Gemfile'))
    .then(() => true, () => false);
  const bundleReady =
    hasGemfile &&
    (await execa('bundle', ['check'], { cwd: appRoot, reject: false })
      .then((result) => result.exitCode === 0)
      .catch(() => false));
  const [command, args]: [string, string[]] = bundleReady
    ? ['bundle', ['exec', 'pod', 'install']]
    : ['pod', ['install']];

  try {
    await withOutputStep('Installing CocoaPods…', () =>
      execa(command, args, { cwd: iosDir, stdio: childStdio() }),
    );
  } catch (error) {
    const retry = bundleReady
      ? 'bundle exec pod install'
      : hasGemfile
        ? 'bundle install && bundle exec pod install'
        : 'pod install';
    logger.warn(
      `pod install failed — run "cd ${path.basename(appRoot)}/ios && ${retry}" once the problem above is fixed. (${error instanceof Error ? error.message.split('\n')[0] : String(error)})`,
    );
  }
}
