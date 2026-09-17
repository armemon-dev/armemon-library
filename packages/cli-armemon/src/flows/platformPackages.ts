/**
 * FILE: platformPackages.ts
 * PATH: packages/cli-armemon/src/flows/platformPackages.ts
 *
 * WHAT: Takes the packages of platforms whose setup failed back out of an app — out
 *       of package.json and out of the lockfile.
 * WHY:  Both `init` and `add` install a platform's package before its attach tool
 *       runs, because the tool needs it. When the attach then failed, only
 *       package.json was edited: the lockfile still listed react-native-windows, and
 *       `npm ci`, `pnpm install --frozen-lockfile` and `yarn --immutable` all refuse
 *       a lockfile that disagrees with package.json — so the first clean install on a
 *       teammate's machine or in CI failed.
 * HOW:  Removes the packages, and only if something was really removed, runs the
 *       app's package manager once more so it rewrites the lockfile. A failure there
 *       is reported with the one command that finishes the job, not thrown: the
 *       platform already failed, and losing the rest of a nearly finished run to a
 *       cleanup step would be the worse outcome.
 * WHEN: After a failed platform attach, in init's reconcile step and in `add`.
 *
 * EXPORTS: takePlatformPackagesBackOut
 * DEPENDS ON: @armemon-library/cli-kit, ../constants
 * USED BY: flows/initReactNative.ts, flows/addPlatform.ts
 */

import {
  logger,
  withOutputStep,
  installDependencies,
  removePackageJsonDependencies,
} from '@armemon-library/cli-kit';
import type { PackageManager, Platform } from '@armemon-library/config-types';
import { PLATFORM_PACKAGES } from '../constants.js';

/** Returns what was removed. */
export async function takePlatformPackagesBackOut(
  appRoot: string,
  platforms: Platform[],
  packageManager: PackageManager,
): Promise<string[]> {
  const removed = await removePackageJsonDependencies(
    appRoot,
    platforms.flatMap((platform) => PLATFORM_PACKAGES[platform] ?? []),
  );
  if (removed.length === 0) return removed;

  try {
    await withOutputStep(`Taking ${removed.join(', ')} back out of the lockfile…`, () =>
      installDependencies(appRoot, packageManager, { retries: 1 }),
    );
  } catch (error) {
    const install = packageManager === 'yarn' ? 'yarn' : `${packageManager} install`;
    logger.warn(
      `${removed.join(', ')} ${removed.length === 1 ? 'is' : 'are'} out of package.json but still in the lockfile, so a clean install (npm ci, --frozen-lockfile) will refuse it. Run "${install}" once in the app to fix that. (${error instanceof Error ? error.message.split('\n')[0] : String(error)})`,
    );
  }

  return removed;
}
