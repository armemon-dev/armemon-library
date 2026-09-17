/**
 * FILE: platformCleanup.ts
 * PATH: packages/cli-kit/src/fs/platformCleanup.ts
 *
 * WHAT: Deletes the native project folder (and its package.json launcher script)
 *       for whichever of iOS/Android wasn't selected by the user.
 * WHY:  The RN CLI's `init` command always scaffolds BOTH ios/ and android/
 *       together — there is no scaffold-time flag to generate only one (confirmed
 *       via `--help`). Cleanup-after-the-fact is the only way to honor a
 *       single-native-platform selection.
 * HOW:  Plain recursive directory removal plus a package.json script-key removal
 *       (RN CLI's default template ships "android"/"ios" bare-name scripts
 *       unconditionally — confirmed against the reference testingApp's
 *       package.json). Windows/macOS/Web are never created by the base scaffold at
 *       all, so there's nothing to clean up for those regardless of selection —
 *       they're purely additive (see rnWindowsCli.ts/rnMacosCli.ts/webScaffold.ts).
 * WHEN: Called once, immediately after the RN CLI shell-out, before anything else
 *       touches the generated tree.
 *
 * EXPORTS: cleanupUnselectedPlatforms
 * DEPENDS ON: node:path, node:fs/promises, @armemon-library/config-types, ./packageJsonScripts
 * USED BY: packages/cli-armemon/src/flows/initReactNative.ts
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import type { Platform } from '@armemon-library/config-types';
import { removePackageJsonScripts } from './packageJsonScripts.js';

export async function cleanupUnselectedPlatforms(
  appRoot: string,
  selectedPlatforms: Platform[],
): Promise<void> {
  const scriptsToRemove: string[] = [];

  if (!selectedPlatforms.includes('ios')) {
    await fs.rm(path.join(appRoot, 'ios'), { recursive: true, force: true });
    scriptsToRemove.push('ios');
  }

  if (!selectedPlatforms.includes('android')) {
    await fs.rm(path.join(appRoot, 'android'), { recursive: true, force: true });
    scriptsToRemove.push('android');
  }

  if (scriptsToRemove.length > 0) {
    await removePackageJsonScripts(appRoot, scriptsToRemove);
  }
}
