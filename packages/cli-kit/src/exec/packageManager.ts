/**
 * FILE: packageManager.ts
 * PATH: packages/cli-kit/src/exec/packageManager.ts
 *
 * WHAT: Detects which package manager an app uses (from lockfile presence) and runs
 *       its install command.
 * WHY:  `detectPackageManager` is no longer used by the main init flow (which now
 *       asks the user up front instead of guessing — see the new
 *       resolvePackageManager() question in initReactNative.ts), but stays exported
 *       as a reasonable primitive for a future `armemon add`/`doctor` command
 *       operating on an *existing* app where there's no wizard context to ask a
 *       fresh question.
 * HOW:  Checks for bun.lock(b) / pnpm-lock.yaml / yarn.lock, defaults to npm; shells
 *       out via execa with stdio inherited so install progress is visible.
 * WHEN: `installDependencies` is called once, after all plugin dependencies have
 *       been merged into package.json, using whichever PackageManager the user
 *       chose. It retries once on failure — see the note on that function.
 *
 * EXPORTS: detectPackageManager, installDependencies
 * DEPENDS ON: node:path, node:fs, execa, @armemon-library/config-types
 * USED BY: packages/cli-armemon/src/flows/initReactNative.ts
 */

import path from 'node:path';
import fs from 'node:fs';
import { execa } from 'execa';
import { childStdio } from './childOutput.js';
import type { PackageManager } from '@armemon-library/config-types';

export function detectPackageManager(appRoot: string): PackageManager {
  if (fs.existsSync(path.join(appRoot, 'bun.lockb')) || fs.existsSync(path.join(appRoot, 'bun.lock'))) {
    return 'bun';
  }
  if (fs.existsSync(path.join(appRoot, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(appRoot, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

/**
 * Runs the install, retrying once on failure.
 *
 * A transient registry error ("Received malformed response from registry ... The
 * registry may be down") is enough to throw away an otherwise-finished scaffold
 * that already spent minutes downloading React Native — observed with yarn on an
 * install that succeeded immediately afterwards. One retry costs nothing when the
 * first attempt works and saves the whole run when it doesn't; a second failure is
 * reported as-is, since a real problem should not be masked by looping.
 */
export async function installDependencies(
  appRoot: string,
  packageManager: PackageManager,
  options: { retries?: number; onRetry?: (error: Error) => void } = {},
): Promise<void> {
  const args = packageManager === 'yarn' ? [] : ['install'];
  const attempts = Math.max(1, (options.retries ?? 1) + 1);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await execa(packageManager, args, { cwd: appRoot, stdio: childStdio() });
      return;
    } catch (error) {
      // A package manager killed by a signal was stopped on purpose — Ctrl-C reaches
      // it too — and retrying would start the whole install again behind the user's back.
      const stopped = typeof (error as { signal?: unknown }).signal === 'string';
      if (attempt === attempts - 1 || stopped) throw error;
      options.onRetry?.(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
