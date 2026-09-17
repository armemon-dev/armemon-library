/**
 * FILE: manifestReader.ts
 * PATH: packages/cli-kit/src/discovery/manifestReader.ts
 *
 * WHAT: Resolves an installed npm package by name — from the CLI's own install OR
 *       from a caller-supplied directory — and reads/validates its "armemon"
 *       package.json field into a PluginManifest.
 * WHY:  This is the generic discovery mechanism every plugin's metadata goes through.
 *       It resolves from EXTRA ROOTS as well as from cli-kit's own location because
 *       resolving only from here made third-party plugins structurally impossible:
 *       a plugin the user installed into their own project could never be found, so
 *       the whole manifest/validation apparatus only ever worked for packages that
 *       were literal dependencies of the CLI itself.
 * HOW:  For each candidate root, three strategies in order: the package's own
 *       "./package.json" export, then its main entry walked up to the package root,
 *       then a direct node_modules lookup. All three are needed because a package
 *       with an exports map that omits "./package.json" — extremely common, and not
 *       something a plugin author would think to add — makes Node refuse the first
 *       one outright, which would have made those plugins undiscoverable. Manifest
 *       fields are then validated, rejecting unknown platform values rather than
 *       letting a typo silently hide a plugin from the catalog later.
 * WHEN: Called once per catalog entry during plugin discovery, and again for any
 *       plugin named explicitly with --plugins.
 *
 * EXPORTS: readArmemonManifest, resolvePackageJsonPath, resolvePackageSubpathUrl,
 *          ManifestReadOptions
 * DEPENDS ON: node:module, node:path, node:fs/promises, @armemon-library/config-types, ../errors
 * USED BY: packages/cli-kit/src/discovery/pluginRegistry.ts
 */

import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import type { Platform, PluginManifest } from '@armemon-library/config-types';
import { CliError } from '../errors.js';

const requireFromHere = createRequire(import.meta.url);

const VALID_PLATFORMS: Platform[] = ['ios', 'android', 'web', 'windows', 'macos'];

export interface ManifestReadOptions {
  /**
   * Directories to resolve from before falling back to cli-kit's own location —
   * normally the target app root and the CWD, so a user-installed plugin wins over
   * a same-named one bundled with the CLI.
   */
  resolveFrom?: string[];
}

export function resolvePackageJsonPath(
  packageName: string,
  options: ManifestReadOptions = {},
): string {
  const roots = [...(options.resolveFrom ?? []).map((root) => path.join(root, 'noop.js')), null];

  for (const base of roots) {
    const req = base === null ? requireFromHere : createRequire(base);

    // Preferred: the package explicitly exports its own package.json.
    try {
      return req.resolve(`${packageName}/package.json`);
    } catch {
      // Not exported. Very common — an exports map that omits "./package.json"
      // makes Node refuse the subpath, and a plugin author has no reason to have
      // added it. Fall through rather than declaring the package missing.
    }

    // Next: resolve the main entry and walk up to the package root.
    try {
      const entry = req.resolve(packageName);
      let dir = path.dirname(entry);
      while (true) {
        const candidate = path.join(dir, 'package.json');
        if (existsSync(candidate)) {
          const name = (JSON.parse(readFileSync(candidate, 'utf8')) as { name?: string }).name;
          if (name === packageName) return candidate;
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    } catch {
      // No resolvable main entry either — a types-only or wizard-only package.
    }

    // Last: look for it directly under node_modules, walking up from the base.
    let dir = base === null ? path.dirname(fileURLToPath(import.meta.url)) : path.dirname(base);
    while (true) {
      const candidate = path.join(dir, 'node_modules', ...packageName.split('/'), 'package.json');
      if (existsSync(candidate)) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  throw new CliError(
    `Couldn't find the package "${packageName}".`,
    `Check the name, and make sure it is installed (npm i -D ${packageName}) if it is a third-party armemon plugin.`,
  );
}

/**
 * Resolves a subpath export of a package to a file URL that `import()` can load.
 *
 * Two things make this necessary rather than just importing `${pkg}/${subpath}`:
 *
 * 1. A bare specifier resolves against the IMPORTER's module context — the CLI's
 *    own install — so a plugin installed in the user's own project was discovered,
 *    listed, selected, and then failed to load.
 * 2. createRequire().resolve() can't help, because a wizard entry is ESM-only: its
 *    exports entry has "import" but no "require" condition, so require-resolution
 *    fails with ERR_PACKAGE_PATH_NOT_EXPORTED.
 *
 * So the package.json is located (its "./package.json" export is conventionally
 * always present, and require-resolves fine), and the subpath is read out of the
 * exports map by hand, honouring the import/node/default conditions in that order.
 * A package with no exports map falls back to a plain path join, which is how
 * pre-exports packages have always worked.
 */
export function resolvePackageSubpathUrl(
  packageName: string,
  subpath: string,
  options: ManifestReadOptions = {},
): string {
  const pkgJsonPath = resolvePackageJsonPath(packageName, options);
  const packageDir = path.dirname(pkgJsonPath);

  let exportsField: unknown;
  try {
    exportsField = (
      JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as { exports?: unknown }
    ).exports;
  } catch {
    exportsField = undefined;
  }

  const pick = (value: unknown): string | undefined => {
    if (typeof value === 'string') return value;
    if (!value || typeof value !== 'object') return undefined;
    const record = value as Record<string, unknown>;
    for (const condition of ['import', 'node', 'default', 'require']) {
      const resolved = pick(record[condition]);
      if (resolved) return resolved;
    }
    return undefined;
  };

  const entry =
    exportsField && typeof exportsField === 'object'
      ? pick((exportsField as Record<string, unknown>)[`./${subpath}`])
      : undefined;

  const target = entry ?? `./${subpath}`;
  const absolute = path.resolve(packageDir, target);

  if (!existsSync(absolute)) {
    // Two different problems, and only one of them is a broken build: a package can
    // simply not have this entry at all.
    throw entry === undefined
      ? new CliError(
          `"${packageName}" has no "./${subpath}" export.`,
          `An armemon plugin needs a "./${subpath}" entry in its package.json exports.`,
        )
      : new CliError(
          `"${packageName}" declares a "./${subpath}" export, but ${absolute} doesn't exist.`,
          'The package may have been published without building, or its exports map is wrong.',
        );
  }

  return pathToFileURL(absolute).href;
}

export async function readArmemonManifest(
  packageName: string,
  options: ManifestReadOptions = {},
): Promise<PluginManifest> {
  const pkgJsonPath = resolvePackageJsonPath(packageName, options);
  const raw = await fs.readFile(pkgJsonPath, 'utf8');

  let pkg: { armemon?: Partial<PluginManifest> };
  try {
    pkg = JSON.parse(raw) as { armemon?: Partial<PluginManifest> };
  } catch (error) {
    throw new CliError(
      `"${packageName}" has an unreadable package.json (${error instanceof Error ? error.message : String(error)}).`,
    );
  }

  const manifest = pkg.armemon;

  if (
    !manifest ||
    !manifest.pluginId ||
    !manifest.runtimeExportName ||
    !manifest.displayName ||
    !manifest.description
  ) {
    throw new CliError(
      `Package "${packageName}" is missing a valid "armemon" manifest field.`,
      'An armemon plugin needs an "armemon" object in its package.json with pluginId, displayName, description and runtimeExportName.',
    );
  }

  const platforms = manifest.platforms;
  if (platforms) {
    if (!Array.isArray(platforms) || platforms.length === 0) {
      throw new CliError(`"${packageName}" declares an empty or non-array "armemon.platforms".`);
    }
    const unknown = platforms.filter((entry) => !VALID_PLATFORMS.includes(entry));
    if (unknown.length > 0) {
      throw new CliError(
        `"${packageName}" declares unknown platform(s): ${unknown.join(', ')}.`,
        `Valid platforms are: ${VALID_PLATFORMS.join(', ')}.`,
      );
    }
  }

  if (manifest.dependsOn && !Array.isArray(manifest.dependsOn)) {
    throw new CliError(`"${packageName}" declares a non-array "armemon.dependsOn".`);
  }

  const settings = manifest.settings;
  if (
    settings !== undefined &&
    (typeof settings !== 'object' ||
      typeof settings.file !== 'string' ||
      typeof settings.exportName !== 'string' ||
      settings.file.startsWith('/') ||
      settings.file.split('/').includes('..'))
  ) {
    throw new CliError(
      `"${packageName}" declares an invalid "armemon.settings".`,
      'Write it as { "file": "<id>/<name>.config.ts", "exportName": "<name>Config" } — a path inside the managed zone.',
    );
  }

  return {
    manifestVersion: 1,
    pluginId: manifest.pluginId,
    displayName: manifest.displayName,
    description: manifest.description,
    category: manifest.category,
    required: manifest.required ?? false,
    runtimeExportName: manifest.runtimeExportName,
    configExportName: manifest.configExportName,
    peerPackages: manifest.peerPackages ?? [],
    platforms,
    dependsOn: manifest.dependsOn ?? [],
    compatibleWith: manifest.compatibleWith,
    settings,
  };
}
