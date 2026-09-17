/**
 * FILE: pluginRegistry.ts
 * PATH: packages/cli-kit/src/discovery/pluginRegistry.ts
 *
 * WHAT: Reads manifests for a list of plugin package names, filters them against the
 *       selected platforms, and orders them so every plugin's declared dependencies
 *       run before it.
 * WHY:  cli-kit stays a generic toolkit — the specific v1 catalog lives in
 *       cli-armemon — but the three things done to a raw name list are the same for
 *       every caller. Ordering is here rather than implicit in a hand-written array
 *       because it used to be: plugin-redux had to precede plugin-navigation (the
 *       sample-auth flow reads Redux's answers), and that was enforced only by a
 *       comment warning that cleaning up the array would silently break it.
 *       Declaring `dependsOn` in the manifest and sorting makes it structural.
 * HOW:  Sequential manifest reads (a failure names the offending package), a
 *       platform filter, then Kahn's algorithm over pluginId edges with the input
 *       order as the tie-break, so ordering stays stable and predictable.
 * WHEN: Called once by the init flow before the plugin-selection prompt.
 *
 * EXPORTS: discoverPlugins, filterPluginsByPlatform, partitionPluginsByReactNative,
 *          sortPluginsByDependencies, DiscoveredPlugin
 * DEPENDS ON: @armemon-library/config-types, ./manifestReader, ../errors
 * USED BY: packages/cli-armemon/src/flows/initReactNative.ts
 */

import semver from 'semver';
import type { Platform, PluginManifest } from '@armemon-library/config-types';
import { readArmemonManifest, type ManifestReadOptions } from './manifestReader.js';
import { CliError } from '../errors.js';

export interface DiscoveredPlugin {
  packageName: string;
  manifest: PluginManifest;
}

export async function discoverPlugins(
  packageNames: string[],
  options: ManifestReadOptions = {},
): Promise<DiscoveredPlugin[]> {
  const results: DiscoveredPlugin[] = [];
  for (const packageName of packageNames) {
    const manifest = await readArmemonManifest(packageName, options);
    results.push({ packageName, manifest });
  }
  return results;
}

/**
 * Splits plugins by whether they work with React Native `rnVersion`, going by each
 * manifest's `compatibleWith.rnMin`.
 *
 * That field was part of the manifest contract and nothing read it, so a plugin that
 * declared it needs 0.74 was offered to — and installed into — a 0.72 app, and failed
 * there. A version that isn't a number yet ("latest") counts as new enough: whatever
 * it resolves to is the newest release. So does a plugin that declares no minimum.
 */
export function partitionPluginsByReactNative(
  plugins: DiscoveredPlugin[],
  rnVersion: string,
): { compatible: DiscoveredPlugin[]; incompatible: Array<{ plugin: DiscoveredPlugin; rnMin: string }> } {
  const version = semver.valid(rnVersion) ? rnVersion : null;
  const compatible: DiscoveredPlugin[] = [];
  const incompatible: Array<{ plugin: DiscoveredPlugin; rnMin: string }> = [];

  for (const plugin of plugins) {
    const rnMin = semver.coerce(plugin.manifest.compatibleWith?.rnMin ?? '')?.version;
    if (version !== null && rnMin !== undefined && semver.lt(version, rnMin)) {
      incompatible.push({ plugin, rnMin });
    } else {
      compatible.push(plugin);
    }
  }
  return { compatible, incompatible };
}

/**
 * Drops plugins that can't work on any selected platform. A plugin with no
 * `platforms` field works everywhere and always survives.
 */
export function filterPluginsByPlatform(
  plugins: DiscoveredPlugin[],
  selected: Platform[],
): DiscoveredPlugin[] {
  return plugins.filter((plugin) => {
    const supported = plugin.manifest.platforms;
    if (!supported || supported.length === 0) return true;
    return supported.some((platform) => selected.includes(platform));
  });
}

/**
 * Topological order over `dependsOn`. A dependency that isn't in the list is
 * ignored (the user simply didn't select it — plugins are expected to degrade,
 * as the sample-auth flow does when Redux is absent); a cycle is a plugin-author
 * error and throws.
 */
export function sortPluginsByDependencies(plugins: DiscoveredPlugin[]): DiscoveredPlugin[] {
  const byId = new Map(plugins.map((plugin) => [plugin.manifest.pluginId, plugin]));
  const remaining = [...plugins];
  const placed = new Set<string>();
  const ordered: DiscoveredPlugin[] = [];

  while (remaining.length > 0) {
    const ready = remaining.filter((plugin) =>
      (plugin.manifest.dependsOn ?? [])
        .filter((id) => byId.has(id))
        .every((id) => placed.has(id)),
    );

    if (ready.length === 0) {
      throw new CliError(
        `Circular plugin dependency among: ${remaining.map((p) => p.manifest.pluginId).join(', ')}.`,
        'One of these plugins declares an "armemon.dependsOn" cycle in its package.json.',
      );
    }

    for (const plugin of ready) {
      ordered.push(plugin);
      placed.add(plugin.manifest.pluginId);
      remaining.splice(remaining.indexOf(plugin), 1);
    }
  }

  return ordered;
}
