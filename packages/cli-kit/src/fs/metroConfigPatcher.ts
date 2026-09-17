/**
 * FILE: metroConfigPatcher.ts
 * PATH: packages/cli-kit/src/fs/metroConfigPatcher.ts
 *
 * WHAT: Overwrites the scaffolded app's metro.config.js to add `watchFolders` for
 *       every locally-linked @armemon-library/* package directory, plus an extraNodeModules
 *       proxy so those packages resolve shared peer deps (react, react-native) from
 *       the app's own node_modules rather than needing their own copies.
 * WHY:  A `file:` dependency alone gets Metro's module resolver "Unable to resolve
 *       module" — npm's file: install creates a symlink into node_modules, but
 *       Metro's file-watcher/HASTE map doesn't follow symlinks outside its watched
 *       root by default, so it never sees those files exist at all. This is the same
 *       fix the reference repo's testingApp needed for its own unpublished local
 *       packages (confirmed working there).
 *
 *       Each linked package's OWN node_modules is blocked. In a checkout those hold
 *       the package's dev copies of React Navigation, React and the rest, and Metro
 *       resolves a linked package's imports from its real path — so it found those
 *       copies before the app's, bundled a second React Navigation, and then failed
 *       on that copy's own dependencies ("Unable to resolve module query-string"),
 *       which the monorepo hoists somewhere Metro isn't watching. With them blocked,
 *       the lookup falls through to extraNodeModules and the app's single copy.
 * HOW:  Overwrites metro.config.js outright (like appEntryPatcher does for App.tsx)
 *       rather than trying to merge with the RN CLI's default — the default isn't
 *       worth preserving/merging, and every scaffolded app needs this same shape.
 * WHEN: Called once, after the dependency install (Step 8), for every @armemon-library/*
 *       package that landed in package.json as a `file:` dependency.
 *
 *
 *       patchMetroWatchFolders adds or removes one linked package's folder in a
 *       metro.config.js that already exists, for `armemon plugin add/remove`.
 *
 * EXPORTS: patchMetroConfigForLocalPackages, buildMetroConfigSource, patchMetroWatchFolders
 * DEPENDS ON: node:path, node:fs/promises, typescript, ./sourceEdit, ./arrayLiteralEdit,
 *             ./patchResult
 * USED BY: packages/cli-armemon/src/flows/initReactNative.ts,
 *          packages/cli-armemon/src/flows/plugins/reconcile.ts
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import ts from 'typescript';
import { applyEdits, parseSource } from './sourceEdit.js';
import { arrayElementInsertion, arrayElementRemoval } from './arrayLiteralEdit.js';
import { brokenReason, checked, refused, type PatchResult } from './patchResult.js';

export async function patchMetroConfigForLocalPackages(
  appRoot: string,
  packageDirs: string[],
): Promise<void> {
  await fs.writeFile(path.join(appRoot, 'metro.config.js'), buildMetroConfigSource(packageDirs), 'utf8');
}

export function buildMetroConfigSource(packageDirs: string[]): string {
  return `const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

// Local, not-yet-published @armemon-library/* packages — see cli-kit's
// metroConfigPatcher.ts for why watchFolders, blockList and extraNodeModules are
// all needed.
const watchFolders = ${JSON.stringify(packageDirs, null, 2)};

const defaults = getDefaultConfig(__dirname);
const escape = (text) => text.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');

const config = {
  watchFolders,
  resolver: {
    // A linked package's own node_modules holds its development copies of shared
    // libraries; the app's copies have to win, or the bundle gets two of each.
    blockList: [
      ...[].concat(defaults.resolver.blockList ?? []),
      ...watchFolders.map((folder) => new RegExp(\`^\${escape(path.join(folder, 'node_modules'))}\\\\\${path.sep}.*\`)),
    ],
    extraNodeModules: new Proxy(
      {},
      {
        get: (_target, name) => path.join(__dirname, 'node_modules', name),
      },
    ),
  },
};

module.exports = mergeConfig(defaults, config);
`;
}

function watchFoldersList(file: ts.SourceFile): ts.ArrayLiteralExpression | null {
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === 'watchFolders' &&
        declaration.initializer &&
        ts.isArrayLiteralExpression(declaration.initializer)
      ) {
        return declaration.initializer;
      }
    }
  }
  return null;
}

/** Adds and removes linked package folders in metro.config.js's `watchFolders`. */
export function patchMetroWatchFolders(content: string, change: { add?: string[]; remove?: string[] }): PatchResult {
  const fileName = 'metro.config.js';
  const manual = [
    change.add?.length ? `Add to watchFolders in metro.config.js:\n${change.add.map((dir) => JSON.stringify(dir)).join('\n')}` : null,
    change.remove?.length ? `Remove from watchFolders in metro.config.js:\n${change.remove.map((dir) => JSON.stringify(dir)).join('\n')}` : null,
  ].filter(Boolean).join('\n');
  const broken = brokenReason(content, fileName);
  if (broken) return refused(content, broken, manual);

  let current = content;
  const valueOf = (element: ts.Expression) => (ts.isStringLiteral(element) ? path.resolve(element.text) : null);

  if (change.remove?.length) {
    const file = parseSource(current, fileName);
    const list = watchFoldersList(file);
    if (!list) return refused(content, 'metro.config.js has no `const watchFolders = [...]`', manual);
    const unwanted = new Set(change.remove.map((dir) => path.resolve(dir)));
    const targets = list.elements.filter((element) => unwanted.has(valueOf(element) ?? ''));
    current = applyEdits(current, arrayElementRemoval(current, file, list, targets));
  }

  if (change.add?.length) {
    const file = parseSource(current, fileName);
    const list = watchFoldersList(file);
    if (!list) return refused(content, 'metro.config.js has no `const watchFolders = [...]`', manual);
    const present = new Set(list.elements.map(valueOf));
    const missing = [...new Set(change.add)].filter((dir) => !present.has(path.resolve(dir)));
    current = applyEdits(current, arrayElementInsertion(current, file, list, missing.map((dir) => JSON.stringify(dir))));
  }

  return checked(content, current, fileName, manual, 'metro.config.js already watches these folders');
}
