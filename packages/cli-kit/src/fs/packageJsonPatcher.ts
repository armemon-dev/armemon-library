/**
 * FILE: packageJsonPatcher.ts
 * PATH: packages/cli-kit/src/fs/packageJsonPatcher.ts
 *
 * WHAT: Merges dependency and devDependency maps into a scaffolded app's
 *       package.json, plus collectDependencies() — which merges every plugin's
 *       contributions while reporting version conflicts instead of hiding them.
 * WHY:  Every selected plugin's plan() contributes dependencies; these all need to
 *       land in package.json before the single batched install. Two plugins asking
 *       for DIFFERENT versions of the same package is entirely reachable (one wizard
 *       answered "recommended", another "custom"), and a plain object spread
 *       resolves that by whichever ran last, silently. collectDependencies() keeps
 *       the same last-write-wins result — the CLI does control the order — but hands
 *       back a conflict list so the flow can tell the user which plugins disagreed
 *       and what was actually installed. devDependencies is a separate channel
 *       because Babel plugins, type stubs and lint configs are build-time-only;
 *       putting them in an app's runtime `dependencies` is simply wrong.
 * HOW:  Read, merge, write back with a trailing newline. Reads and writes are
 *       sequential per call, so the several patchers that touch package.json during
 *       one run never interleave.
 * WHEN: collectDependencies() runs once all plans are collected; mergeDependencies()
 *       runs immediately after, before the install step.
 *
 * EXPORTS: mergeDependencies, collectDependencies, DependencyContribution,
 *          DependencyConflict, CollectedDependencies
 * DEPENDS ON: node:path, node:fs/promises
 * USED BY: packages/cli-armemon/src/flows/initReactNative.ts
 */

import path from 'node:path';
import fs from 'node:fs/promises';

export interface DependencyContribution {
  /** Human-readable requester, e.g. a pluginId or "web target". */
  source: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface DependencyConflict {
  packageName: string;
  /** Every distinct request, in the order they were contributed. */
  requests: Array<{ source: string; version: string }>;
  /** The version that actually won (the last one requested). */
  resolved: string;
}

export interface CollectedDependencies {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  conflicts: DependencyConflict[];
}

function mergeInto(
  target: Record<string, string>,
  seen: Map<string, Array<{ source: string; version: string }>>,
  source: string,
  incoming: Record<string, string> | undefined,
): void {
  for (const [name, version] of Object.entries(incoming ?? {})) {
    const history = seen.get(name) ?? [];
    history.push({ source, version });
    seen.set(name, history);
    target[name] = version;
  }
}

export function collectDependencies(
  contributions: DependencyContribution[],
): CollectedDependencies {
  const dependencies: Record<string, string> = {};
  const devDependencies: Record<string, string> = {};
  const seen = new Map<string, Array<{ source: string; version: string }>>();

  for (const contribution of contributions) {
    mergeInto(dependencies, seen, contribution.source, contribution.dependencies);
    mergeInto(devDependencies, seen, contribution.source, contribution.devDependencies);
  }

  const conflicts: DependencyConflict[] = [];
  for (const [packageName, requests] of seen) {
    const distinct = new Set(requests.map((request) => request.version));
    if (distinct.size > 1) {
      conflicts.push({
        packageName,
        requests,
        resolved: dependencies[packageName] ?? devDependencies[packageName] ?? '',
      });
    }
  }

  return { dependencies, devDependencies, conflicts };
}

export async function mergeDependencies(
  appRoot: string,
  dependencies: Record<string, string>,
  devDependencies: Record<string, string> = {},
): Promise<void> {
  const pkgPath = path.join(appRoot, 'package.json');
  const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  if (Object.keys(dependencies).length > 0) {
    pkg.dependencies = { ...pkg.dependencies, ...dependencies };
  }
  if (Object.keys(devDependencies).length > 0) {
    pkg.devDependencies = { ...pkg.devDependencies, ...devDependencies };
  }

  await fs.writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
}
