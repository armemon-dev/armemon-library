/**
 * FILE: typescriptRemoval.ts
 * PATH: packages/cli-kit/src/fs/typescriptRemoval.ts
 *
 * WHAT: Strips the TypeScript scaffolding that the React Native template installs,
 *       for apps the user asked to be JavaScript.
 * WHY:  RN's template is TypeScript unconditionally — tsconfig.json, a `typescript`
 *       devDependency, `@types/*` packages and a `.tsx` entry point — with no flag
 *       to opt out. Leaving all of that in a JavaScript app is exactly the outcome
 *       the language question exists to avoid: the user says "JavaScript" and still
 *       gets a TypeScript project with JS files in it.
 * HOW:  Deletes the TS config and the template's own App.tsx (armemon writes its own
 *       entry either way), and removes the TS-only devDependencies before the single
 *       batched install runs, so they're never downloaded rather than installed and
 *       then orphaned.
 * WHEN: Called once, after platform cleanup and before dependency merging, only when
 *       the chosen language is JavaScript.
 *
 * EXPORTS: removeTypeScriptScaffolding, TYPESCRIPT_ONLY_DEV_DEPENDENCIES
 * DEPENDS ON: node:path, node:fs/promises
 * USED BY: packages/cli-armemon/src/flows/initReactNative.ts
 */

import path from 'node:path';
import fs from 'node:fs/promises';

/**
 * Present in the RN template purely to support TypeScript.
 *
 * `typescript` itself is NOT one of them, though it looks like it. React Native's
 * ESLint config loads @typescript-eslint whatever the app's language, and that
 * declares `typescript` as a peer — so with the template's pinned copy removed, npm
 * installed the newest TypeScript to satisfy the peer. Once TypeScript 7 was out,
 * @typescript-eslint 7 crashed loading it ("Environment key jest/globals is
 * unknown"), and `npm run lint` failed in every new JavaScript app.
 */
export const TYPESCRIPT_ONLY_DEV_DEPENDENCIES = [
  '@types/react',
  '@types/react-test-renderer',
  '@types/jest',
  '@react-native/typescript-config',
];

const TYPESCRIPT_ONLY_FILES = ['tsconfig.json', 'App.tsx'];

export interface TypeScriptRemovalResult {
  removedFiles: string[];
  removedDependencies: string[];
}

export async function removeTypeScriptScaffolding(
  appRoot: string,
): Promise<TypeScriptRemovalResult> {
  const removedFiles: string[] = [];

  for (const relative of TYPESCRIPT_ONLY_FILES) {
    const target = path.join(appRoot, relative);
    const existed = await fs
      .access(target)
      .then(() => true)
      .catch(() => false);
    if (!existed) continue;
    await fs.rm(target, { force: true });
    removedFiles.push(relative);
  }

  const pkgPath = path.join(appRoot, 'package.json');
  const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8')) as {
    devDependencies?: Record<string, string>;
  };

  const removedDependencies: string[] = [];
  for (const name of TYPESCRIPT_ONLY_DEV_DEPENDENCIES) {
    if (pkg.devDependencies?.[name]) {
      delete pkg.devDependencies[name];
      removedDependencies.push(name);
    }
  }

  await fs.writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

  return { removedFiles, removedDependencies };
}
