/**
 * FILE: registration.ts
 * PATH: packages/core/src/provider/plugins/registration.ts
 *
 * WHAT: Validates a list of RuntimePluginObjects against the plugin contract and
 *       returns them sorted by ascending `index` for provider-chain composition.
 * WHY:  A malformed plugin (missing provider, duplicate name, wrong-typed index)
 *       should fail loudly at app-startup, not silently produce a broken provider
 *       tree — this is the single runtime enforcement point of the plugin contract
 *       described in @armemon-library/config-types.
 * HOW:  Hard-throws with a descriptive message on the first violation found; a plain
 *       array sort (not a graph) is sufficient here since composition order is a
 *       total order on `index`, unlike task dependencies which can branch.
 * WHEN: Called once by KitProvider on every render where the plugin list identity
 *       changes (memoized so it only actually re-runs when plugins change).
 *
 * EXPORTS: validatePlugin, registerPlugins
 * DEPENDS ON: @armemon-library/config-types
 * USED BY: packages/core/src/provider/KitProvider.tsx
 */

import type { RuntimePluginObject } from '@armemon-library/config-types';

/**
 * A React component is a function OR an object: React.memo() and forwardRef()
 * both return objects with a $$typeof tag. A plain `typeof === 'function'` check
 * rejected those, so a plugin author wrapping their provider in memo — an
 * entirely ordinary thing to do — hit a validation error saying their component
 * wasn't a component.
 */
function isComponentLike(value: unknown): boolean {
  if (typeof value === 'function') return true;
  return typeof value === 'object' && value !== null && '$$typeof' in value;
}

export function validatePlugin(plugin: RuntimePluginObject): void {
  if (typeof plugin.name !== 'string' || plugin.name.length === 0) {
    throw new Error('armemon plugin is missing a valid "name" string.');
  }
  if (!isComponentLike(plugin.provider)) {
    throw new Error(
      `armemon plugin "${plugin.name}" is missing a valid "provider" component.`,
    );
  }
  if (plugin.index !== undefined && typeof plugin.index !== 'number') {
    throw new Error(`armemon plugin "${plugin.name}" has a non-numeric "index".`);
  }
  if (plugin.tasks !== undefined && !Array.isArray(plugin.tasks)) {
    throw new Error(`armemon plugin "${plugin.name}" has a "tasks" field that isn't an array.`);
  }
  if (plugin.loadingComponent !== undefined && !isComponentLike(plugin.loadingComponent)) {
    throw new Error(`armemon plugin "${plugin.name}" has a non-component "loadingComponent".`);
  }
}

export function registerPlugins(plugins: RuntimePluginObject[]): RuntimePluginObject[] {
  const seen = new Set<string>();

  for (const plugin of plugins) {
    validatePlugin(plugin);
    if (seen.has(plugin.name)) {
      throw new Error(`Duplicate armemon plugin name: "${plugin.name}".`);
    }
    seen.add(plugin.name);
  }

  // Array.prototype.sort is stable in every engine this targets, so plugins that
  // share an index keep their registration order rather than shuffling per run.
  return [...plugins].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}
