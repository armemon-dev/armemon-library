/**
 * FILE: projectPlugins.ts
 * PATH: packages/cli-kit/src/discovery/projectPlugins.ts
 *
 * WHAT: Finds armemon plugins installed in the user's own project by reading its
 *       package.json and checking each dependency for an "armemon" manifest.
 * WHY:  Without this, third-party plugins are structurally impossible. The manifest
 *       contract, the validated fields, the explicit runtimeExportName, the
 *       dependsOn ordering — all of it existed, and none of it was reachable by
 *       anyone but the CLI's own bundled packages, because the catalog was a
 *       hardcoded array. Making a named package RESOLVABLE from the project (which
 *       manifestReader's resolveFrom does) is only half of it: something has to
 *       enumerate candidates in the first place. This is that half.
 * HOW:  Reads dependencies + devDependencies from the project's package.json and
 *       attempts readArmemonManifest() on each. A package without an "armemon"
 *       field is silently skipped — that's the overwhelming majority of them, and
 *       not an error. A package WITH one that's malformed is reported, because that
 *       is a plugin author's bug they need to see.
 * WHEN: Called alongside the built-in catalog, before the plugin-selection prompt,
 *       and by `armemon list`.
 *
 * EXPORTS: discoverProjectPlugins, resolvePluginSpecifier, readPackageVersion
 * DEPENDS ON: node:path, node:fs/promises, ./manifestReader, ../logger
 * USED BY: packages/cli-armemon/src/flows/initReactNative.ts, src/commands/list.ts
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { readArmemonManifest, resolvePackageJsonPath } from './manifestReader.js';
import type { DiscoveredPlugin } from './pluginRegistry.js';
import { logger } from '../logger.js';

interface ProjectPackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * Plugins declared as dependencies of `projectRoot`. Never throws for a project
 * without a package.json — running `armemon init` from an empty directory is the
 * normal case.
 */
export async function discoverProjectPlugins(projectRoot: string): Promise<DiscoveredPlugin[]> {
  const raw = await fs
    .readFile(path.join(projectRoot, 'package.json'), 'utf8')
    .catch(() => null);
  if (!raw) return [];

  let pkg: ProjectPackageJson;
  try {
    pkg = JSON.parse(raw) as ProjectPackageJson;
  } catch {
    return [];
  }

  const candidates = [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ];

  const found: DiscoveredPlugin[] = [];

  for (const packageName of [...new Set(candidates)]) {
    let manifestRaw: string;
    try {
      manifestRaw = await fs.readFile(
        resolvePackageJsonPath(packageName, { resolveFrom: [projectRoot] }),
        'utf8',
      );
    } catch {
      continue; // Not installed — nothing to inspect.
    }

    // Cheap pre-check so a project with 900 dependencies isn't 900 full manifest
    // validations, and so only packages that MEANT to be plugins can produce an error.
    //
    // The key followed by an object, not the bare word: a substring search matched
    // `"keywords": ["armemon"]`, so every first-party package — @armemon-library/core and
    // @armemon-library/config-types included — was reported as a broken plugin, in a warning
    // the reader can do nothing about.
    if (!/"armemon"\s*:\s*\{/.test(manifestRaw)) continue;

    try {
      const manifest = await readArmemonManifest(packageName, { resolveFrom: [projectRoot] });
      found.push({ packageName, manifest });
    } catch (error) {
      logger.warn(
        `Skipping "${packageName}": it has an "armemon" field but it isn't valid. ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return found;
}

/**
 * The dependency specifier a scaffolded app should use for a third-party plugin.
 *
 * Prefers however the HOST project declares it, so a plugin linked with
 * `file:../my-plugin` or `workspace:*` carries that through instead of being pinned
 * to a caret range that doesn't exist on the registry — which fails the install
 * outright. Falls back to the installed version for a plugin that's present but
 * undeclared.
 */
export async function resolvePluginSpecifier(
  packageName: string,
  projectRoot: string,
): Promise<string> {
  const raw = await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8').catch(() => null);
  if (raw) {
    try {
      const pkg = JSON.parse(raw) as ProjectPackageJson;
      const declared = pkg.dependencies?.[packageName] ?? pkg.devDependencies?.[packageName];
      if (declared) {
        // A relative file: path is relative to the HOST, and the app lives
        // elsewhere — make it absolute so it still resolves.
        if (declared.startsWith('file:')) {
          return `file:${path.resolve(projectRoot, declared.slice('file:'.length))}`;
        }
        return declared;
      }
    } catch {
      // Fall through to the installed version.
    }
  }

  const version = await readPackageVersion(packageName, [projectRoot]);
  return version ? `^${version}` : 'latest';
}

/** The installed version of a package. */
export async function readPackageVersion(
  packageName: string,
  resolveFrom: string[],
): Promise<string | null> {
  try {
    const raw = await fs.readFile(resolvePackageJsonPath(packageName, { resolveFrom }), 'utf8');
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}
