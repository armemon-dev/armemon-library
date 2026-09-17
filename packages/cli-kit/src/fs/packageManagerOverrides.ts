/**
 * FILE: packageManagerOverrides.ts
 * PATH: packages/cli-kit/src/fs/packageManagerOverrides.ts
 *
 * WHAT: Writes a package-manager-specific "force this dependency to resolve here"
 *       override block into the scaffolded app's package.json, for every local
 *       @armemon-library/* package.
 * WHY:  A `file:` specifier on the app's own top-level dependencies is NOT enough —
 *       @armemon-library/core, every plugin, etc. each declare their OWN dependency on
 *       @armemon-library/config-types and @armemon-library/cli-kit as a bare `"*"` range (correct
 *       inside the armemon-library workspace, where npm/pnpm resolve "*" against
 *       the sibling workspace package; meaningless once these packages are
 *       referenced via file: from a wholly separate, non-workspace project). npm's
 *       flat-hoisting resolver happens to paper over this (it satisfies "*" from
 *       whatever's already hoisted at the top level, even if unrelated) — pnpm's
 *       strict, content-addressable resolver does not, and legitimately tries to
 *       fetch "@armemon-library/config-types" from the real npm registry, where it 404s
 *       (confirmed the hard way: this exact failure happened in a real
 *       `--all-accept` end-to-end run). Overrides force EVERY reference to these
 *       package names, at ANY depth in the dependency graph, to resolve to the
 *       given file: path — not just the ones the app's own package.json declares
 *       directly.
 * HOW:  Each package manager spells this differently: npm/bun use a top-level
 *       "overrides" field, pnpm nests it under "pnpm.overrides", yarn (classic)
 *       uses "resolutions". All three are semantically the override mechanism, just
 *       different JSON shapes.
 * WHEN: Called once, alongside the file: dependency additions, before the
 *       dependency install step.
 *
 * EXPORTS: writePackageManagerOverrides
 * DEPENDS ON: node:path, node:fs/promises, @armemon-library/config-types
 * USED BY: packages/cli-armemon/src/flows/initReactNative.ts
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import type { PackageManager } from '@armemon-library/config-types';

interface PackageJsonShape {
  overrides?: Record<string, string>;
  resolutions?: Record<string, string>;
  pnpm?: { overrides?: Record<string, string>; [key: string]: unknown };
  [key: string]: unknown;
}

export async function writePackageManagerOverrides(
  appRoot: string,
  packageManager: PackageManager,
  overrides: Record<string, string>,
): Promise<void> {
  const pkgPath = path.join(appRoot, 'package.json');
  const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8')) as PackageJsonShape;

  if (packageManager === 'pnpm') {
    pkg.pnpm = { ...pkg.pnpm, overrides: { ...pkg.pnpm?.overrides, ...overrides } };
  } else if (packageManager === 'yarn') {
    pkg.resolutions = { ...pkg.resolutions, ...overrides };
  } else {
    // npm and bun both use a top-level "overrides" field.
    pkg.overrides = { ...pkg.overrides, ...overrides };
  }

  await fs.writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
}
