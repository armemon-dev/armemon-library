/**
 * FILE: npmrcWriter.ts
 * PATH: packages/cli-kit/src/fs/npmrcWriter.ts
 *
 * WHAT: Writes (or appends to) the scaffolded app's .npmrc with settings needed by
 *       specific platform/package-manager combinations: `node-linker=hoisted` for
 *       pnpm, `legacy-peer-deps=true` for macOS.
 * WHY:  pnpm's default node_modules layout uses strict per-package symlinked
 *       directories (not a flat tree); Metro's file-watcher/resolver was written
 *       assuming npm/yarn's flatter layout and doesn't reliably follow pnpm's
 *       stricter isolation without this setting, a well-known community-documented
 *       RN+pnpm compatibility fix. Separately, `react-native-macos-init` always
 *       shells out to plain `npm install` internally to fetch its own
 *       `react-native-macos` dependency — regardless of the project's actual chosen
 *       package manager — and that internal npm call has no way for armemon to pass
 *       it `--legacy-peer-deps` directly. Confirmed live: `react-native-macos`
 *       releases pin an EXACT peer react-native patch version (e.g.
 *       `react-native-macos@0.76.12` peers on exactly `react-native@0.76.9`) that
 *       essentially never matches whatever exact patch the app was actually
 *       scaffolded with, so npm's strict ERESOLVE check hard-fails the internal
 *       install every time unless legacy-peer-deps is set — this is an npm-only
 *       config key (harmless no-op for pnpm/yarn/bun, which don't hard-fail on peer
 *       mismatches by default anyway), so it's safe to always write when macOS is
 *       targeted regardless of the project's own package manager choice.
 * HOW:  Reads the existing .npmrc (if the RN CLI template ever ships one — not
 *       confirmed either way, so this defensively appends rather than assuming a
 *       blind overwrite is safe) and appends the line if not already present.
 * WHEN: writeNpmrcForPnpm is called once, only when the user chose pnpm as their
 *       package manager. writeNpmrcForMacos is called once, only when 'macos' is
 *       among the selected platforms. Both run immediately before the dependency
 *       install step (and, for macOS, before the react-native-macos-init shell-out
 *       that runs after that install).
 *
 * EXPORTS: writeNpmrcForPnpm, writeNpmrcForMacos
 * DEPENDS ON: node:path, node:fs/promises
 * USED BY: packages/cli-armemon/src/flows/initReactNative.ts
 */

import path from 'node:path';
import fs from 'node:fs/promises';

const HOISTED_LINE = 'node-linker=hoisted';
const LEGACY_PEER_DEPS_LINE = 'legacy-peer-deps=true';

async function appendNpmrcLine(appRoot: string, line: string): Promise<void> {
  const npmrcPath = path.join(appRoot, '.npmrc');
  const existing = await fs.readFile(npmrcPath, 'utf8').catch(() => '');

  if (existing.includes(line)) return;

  const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  await fs.writeFile(npmrcPath, `${existing}${separator}${line}\n`, 'utf8');
}

export async function writeNpmrcForPnpm(appRoot: string): Promise<void> {
  await appendNpmrcLine(appRoot, HOISTED_LINE);
}

export async function writeNpmrcForMacos(appRoot: string): Promise<void> {
  await appendNpmrcLine(appRoot, LEGACY_PEER_DEPS_LINE);
}
