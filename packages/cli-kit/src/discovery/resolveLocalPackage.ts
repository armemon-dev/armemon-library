/**
 * FILE: resolveLocalPackage.ts
 * PATH: packages/cli-kit/src/discovery/resolveLocalPackage.ts
 *
 * WHAT: Works out how a scaffolded app should depend on an @armemon-library/* runtime
 *       package — a registry range when that package came from npm, a `file:` link
 *       when it came from this monorepo.
 * WHY:  Both answers are wrong in the other's situation, and only one of them used
 *       to exist.
 *
 *       `file:` was right while nothing was published: a semver range would 404.
 *       But it points at wherever the CLI happens to be installed, and once the CLI
 *       itself is installed from npm that is a path inside the user's node_modules
 *       — or, under `npx`, a cache directory that gets cleaned. Every scaffolded app
 *       would carry an absolute path that is meaningless on a teammate's machine, in
 *       CI, and eventually on the author's own machine.
 *
 *       A range is right the moment the packages exist on npm, and the correct range
 *       is knowable: the CLI depends on these packages itself, so whatever version is
 *       installed alongside it is exactly the version that was published with it.
 * HOW:  Resolve the package, read its version, then decide which form to emit by
 *       where it really lives. A published install resolves inside a node_modules
 *       directory; a workspace symlink resolves back to the checkout, outside one.
 *       realpath is what separates them — the symlink's own path is inside
 *       node_modules in both cases.
 * WHEN: Called once per @armemon-library/* runtime package that lands in the scaffolded
 *       app's dependencies (Step 8 of the init flow).
 *
 * EXPORTS: resolveLocalPackageDir, buildFileDependencySpecifier,
 *          isWorkspacePackage, buildArmemonDependencySpecifier, ResolveLocalPackageOptions
 * DEPENDS ON: node:module, node:path, node:fs
 * USED BY: packages/cli-armemon/src/flows/initReactNative.ts
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const requireFromHere = createRequire(import.meta.url);

export interface ResolveLocalPackageOptions {
  /**
   * Directories to resolve from before this file's own location — in practice the
   * CLI's own directory.
   *
   * Resolving from cli-kit alone only worked where a package manager hoists every
   * package into one node_modules. cli-kit doesn't depend on the plugins or core, so
   * under a strict layout (pnpm dlx, Yarn PnP, some global installs) none of them is
   * visible from here — and every @armemon-library dependency of a new app quietly
   * became "latest". The CLI depends on all of them, so resolving from the CLI finds
   * them in any layout.
   */
  resolveFrom?: string[];
}

export function resolveLocalPackageDir(
  packageName: string,
  options: ResolveLocalPackageOptions = {},
): string {
  for (const root of options.resolveFrom ?? []) {
    try {
      return path.dirname(createRequire(path.join(root, 'noop.js')).resolve(`${packageName}/package.json`));
    } catch {
      // Not visible from this root; try the next.
    }
  }
  const pkgJsonPath = requireFromHere.resolve(`${packageName}/package.json`);
  return path.dirname(pkgJsonPath);
}

export function buildFileDependencySpecifier(
  packageName: string,
  options: ResolveLocalPackageOptions = {},
): string {
  return `file:${resolveLocalPackageDir(packageName, options)}`;
}

/**
 * True when this package is the monorepo's own source rather than an npm install.
 *
 * A workspace dependency is a symlink from node_modules into the checkout, so its
 * REAL path has no node_modules segment. An installed package's real path does,
 * under every package manager (npm and yarn place it directly, pnpm behind
 * node_modules/.pnpm). A missing package is treated as installed, so a resolution
 * failure surfaces as a registry range rather than a `file:` path to nowhere.
 */
export function isWorkspacePackage(
  packageName: string,
  options: ResolveLocalPackageOptions = {},
): boolean {
  try {
    const real = fs.realpathSync(resolveLocalPackageDir(packageName, options));
    return !real.split(path.sep).includes('node_modules');
  } catch {
    return false;
  }
}

/**
 * How a scaffolded app should depend on `packageName`.
 *
 * `^<version>` for a published package — the version the CLI itself was published
 * with, since that is the copy sitting next to it. `file:<dir>` when running from
 * the monorepo, where that version does not exist on any registry yet. `latest`
 * only when the package can't be found at all, which the caller should say out loud.
 */
export function buildArmemonDependencySpecifier(
  packageName: string,
  options: ResolveLocalPackageOptions = {},
): string {
  if (isWorkspacePackage(packageName, options)) return buildFileDependencySpecifier(packageName, options);

  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(resolveLocalPackageDir(packageName, options), 'package.json'), 'utf8'),
    ) as { version?: string };
    if (manifest.version) return `^${manifest.version}`;
  } catch {
    // Fall through: a range with no version is not something to guess at.
  }

  return 'latest';
}
