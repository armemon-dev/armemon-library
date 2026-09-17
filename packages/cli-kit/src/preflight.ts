/**
 * FILE: preflight.ts
 * PATH: packages/cli-kit/src/preflight.ts
 *
 * WHAT: The checks that run BEFORE the first question — target directory is free and
 *       writable, Node is new enough, and the tools the flow shells out to exist.
 * WHY:  Without these, a user answered twenty-plus prompts across six wizards and
 *       only then discovered that the folder already existed, or that `npx` wasn't
 *       on PATH. Everything here is knowable in the first second of the command, and
 *       failing in the first second is the whole point.
 * HOW:  Plain fs/exec probes returning CliError with an actionable hint. The
 *       directory check treats an EXISTING-but-empty directory as fine (people
 *       `mkdir` then scaffold into it) and a non-empty one as fatal.
 * WHEN: Called once by the init flow, immediately after the app name is resolved and
 *       before any other prompt.
 *
 * EXPORTS: MIN_NODE_VERSION, isSupportedNodeVersion, assertNodeVersion,
 *          assertTargetDirectoryUsable, assertCommandAvailable,
 *          runPreflight
 * DEPENDS ON: node:path, node:fs/promises, execa, ./errors
 * USED BY: packages/cli-armemon/src/flows/initReactNative.ts
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { execa } from 'execa';
import { CliError } from './errors.js';

/**
 * The oldest Node armemon runs on — the same floor as every package.json's `engines`.
 *
 * This used to check the major version only (18) while engines said 18.18, so the
 * two disagreed on 18.0–18.17. It is now 20.19: Node 18 is past end of life, and the
 * React Native and Vite versions armemon installs today need 20.19 themselves, so an
 * older Node fails later and less clearly than it does here.
 */
export const MIN_NODE_VERSION = '20.19.0';

/** True when `version` (like process.versions.node) is at least MIN_NODE_VERSION. */
export function isSupportedNodeVersion(version: string): boolean {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const [minMajor = 0, minMinor = 0, minPatch = 0] = MIN_NODE_VERSION.split('.').map(Number);
  if (major !== minMajor) return major > minMajor;
  if (minor !== minMinor) return minor > minMinor;
  return patch >= minPatch;
}

export function assertNodeVersion(): void {
  if (!isSupportedNodeVersion(process.versions.node)) {
    throw new CliError(
      `armemon needs Node ${MIN_NODE_VERSION} or newer; this is Node ${process.versions.node}.`,
      'Install a current Node LTS (nvm install --lts) and re-run.',
    );
  }
}

/**
 * Returns true when the directory already existed (so a failed run knows not to
 * delete something it didn't create).
 */
export async function assertTargetDirectoryUsable(targetDir: string): Promise<boolean> {
  const stat = await fs.stat(targetDir).catch(() => null);

  if (!stat) {
    // Parent must exist and be writable, or the RN CLI fails much later.
    const parent = path.dirname(targetDir);
    await fs.access(parent, fs.constants.W_OK).catch(() => {
      throw new CliError(
        `Can't write into ${parent}.`,
        'Check the directory permissions, or run from somewhere you own.',
      );
    });
    return false;
  }

  if (!stat.isDirectory()) {
    throw new CliError(
      `${targetDir} already exists and is a file, not a directory.`,
      'Pick a different app name, or move that file out of the way.',
    );
  }

  const entries = await fs.readdir(targetDir);
  if (entries.length > 0) {
    throw new CliError(
      `${targetDir} already exists and isn't empty (${entries.length} entries).`,
      'Pick a different app name, or delete/rename that directory first.',
    );
  }

  return true;
}

export async function assertCommandAvailable(command: string, hint: string): Promise<void> {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  try {
    await execa(probe, [command], { stdio: 'ignore' });
  } catch {
    throw new CliError(`Required command "${command}" was not found on PATH.`, hint);
  }
}

export interface PreflightOptions {
  targetDir: string;
  packageManager?: string;
}

/** Returns true when the target directory already existed before this run. */
export async function runPreflight(options: PreflightOptions): Promise<boolean> {
  assertNodeVersion();
  const preExisting = await assertTargetDirectoryUsable(options.targetDir);
  await assertCommandAvailable(
    'npx',
    'npx ships with npm — install Node from nodejs.org, or repair your npm install.',
  );
  if (options.packageManager && options.packageManager !== 'npm') {
    await assertCommandAvailable(
      options.packageManager,
      `Install ${options.packageManager}, or re-run and choose a package manager you have.`,
    );
  }
  return preExisting;
}
