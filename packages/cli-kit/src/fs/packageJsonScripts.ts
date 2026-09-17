/**
 * FILE: packageJsonScripts.ts
 * PATH: packages/cli-kit/src/fs/packageJsonScripts.ts
 *
 * WHAT: Adds or removes entries in the scaffolded app's package.json "scripts"
 *       field.
 * WHY:  Separate from packageJsonPatcher.ts (whose sole documented responsibility
 *       is dependency merging) — script mutation is a distinct concern: platform
 *       cleanup needs to remove the RN CLI template's stale "ios"/"android" scripts
 *       for platforms that got deleted, and platform scaffolding needs to add the
 *       bare-name launcher scripts ("android", "ios", "web", "windows", "macos")
 *       for whichever platforms are actually present.
 * HOW:  Reads package.json, mutates the "scripts" object, writes back — mirrors
 *       mergeDependencies' read-mutate-write shape for dependencies.
 * WHEN: `removePackageJsonScripts` runs during platform cleanup (right after the RN
 *       CLI shell-out); `addPackageJsonScripts` runs once all selected platforms'
 *       scaffolding steps are known, alongside the dependency merge.
 *
 * EXPORTS: addPackageJsonScripts, removePackageJsonScripts, removePackageJsonDependencies
 * DEPENDS ON: node:path, node:fs/promises
 * USED BY: packages/cli-kit/src/fs/platformCleanup.ts, packages/cli-armemon/src/flows/initReactNative.ts
 */

import path from 'node:path';
import fs from 'node:fs/promises';

interface PackageJsonShape {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [key: string]: unknown;
}

async function readPackageJson(appRoot: string): Promise<PackageJsonShape> {
  const pkgPath = path.join(appRoot, 'package.json');
  return JSON.parse(await fs.readFile(pkgPath, 'utf8')) as PackageJsonShape;
}

async function writePackageJson(appRoot: string, pkg: PackageJsonShape): Promise<void> {
  const pkgPath = path.join(appRoot, 'package.json');
  await fs.writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
}

export async function addPackageJsonScripts(
  appRoot: string,
  scripts: Record<string, string>,
): Promise<void> {
  const pkg = await readPackageJson(appRoot);
  pkg.scripts = { ...pkg.scripts, ...scripts };
  await writePackageJson(appRoot, pkg);
}

export async function removePackageJsonScripts(appRoot: string, scriptNames: string[]): Promise<void> {
  const pkg = await readPackageJson(appRoot);
  if (!pkg.scripts) return;

  for (const name of scriptNames) {
    delete pkg.scripts[name];
  }

  await writePackageJson(appRoot, pkg);
}

/**
 * Drops packages that were installed for something that then didn't happen.
 *
 * A platform whose attach step fails is removed from the config and loses its
 * launcher script, but its dependency stayed: an app with no windows/ folder still
 * carried react-native-windows, which is large, pulls its own toolchain, and is
 * installed for every teammate on every platform. Removing the entry doesn't
 * uninstall what is already in node_modules — the next clean install is what makes
 * it real, which is exactly when it matters.
 */
/**
 * Returns the names that were really there. package.json is only half of it: the
 * lockfile still lists what was removed until the package manager runs again, and
 * `npm ci` refuses a lockfile that disagrees with package.json — so a caller that
 * removed something has to re-run the install.
 */
export async function removePackageJsonDependencies(
  appRoot: string,
  packageNames: string[],
): Promise<string[]> {
  const pkg = await readPackageJson(appRoot);
  const removed: string[] = [];

  for (const name of packageNames) {
    if (pkg.dependencies?.[name] === undefined && pkg.devDependencies?.[name] === undefined) continue;
    delete pkg.dependencies?.[name];
    delete pkg.devDependencies?.[name];
    removed.push(name);
  }

  await writePackageJson(appRoot, pkg);
  return removed;
}
