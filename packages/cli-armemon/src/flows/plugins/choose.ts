/**
 * FILE: choose.ts
 * PATH: packages/cli-armemon/src/flows/plugins/choose.ts
 *
 * WHAT: Which plugin a command means, and whether it can go into this app at all.
 * WHY:  Rule R7 of docs/plugins.md: everything knowable up front is checked before a
 *       question is asked or a file is read twice — an unknown plugin, one for platforms
 *       the app doesn't target, one that needs a newer React Native, and a plugin from
 *       a different source than the rest of the app's @armemon-library packages, which
 *       would leave two copies of core in one bundle.
 * HOW:  A name resolves by plugin id, then by package name; with no name, the person
 *       picks from a list, and a script (--json, --all-accept) is told to name one.
 * WHEN: At the start of `armemon plugin add` and `plugin remove`.
 *
 * EXPORTS: choosePlugin, assertCompatible
 * DEPENDS ON: semver, @armemon-library/cli-kit, ./appState, ./compose
 * USED BY: flows/plugins/addPlugin.ts, flows/plugins/removePlugin.ts
 */

import semver from 'semver';
import {
  CliError,
  filterPluginsByPlatform,
  isAutoAcceptEnabled,
  isWorkspacePackage,
  partitionPluginsByReactNative,
  promptSelect,
  readPackageVersion,
  type DiscoveredPlugin,
} from '@armemon-library/cli-kit';
import { CLI_DIR, type AppState } from './appState.js';
import { isFirstParty } from './compose.js';

export async function choosePlugin(
  state: AppState,
  requested: string | undefined,
  action: 'add' | 'remove',
): Promise<DiscoveredPlugin | string> {
  const installed = (plugin: DiscoveredPlugin) => plugin.manifest.pluginId in state.config.plugins;

  if (requested) {
    const found = state.catalog.find(
      (plugin) => plugin.manifest.pluginId === requested || plugin.packageName === requested,
    );
    // Removing needs only the id: whether its package can be found is the flow's to say.
    if (!found && action === 'remove') return requested;
    if (!found) {
      throw new CliError(
        `"${requested}" isn't a plugin armemon can find.`,
        `Available: ${state.catalog.map((plugin) => plugin.manifest.pluginId).join(', ')}. A plugin from npm has to be installed in the app first — "${state.packageManager} ${state.packageManager === 'npm' ? 'install' : 'add'} <package>" — then run "armemon plugin add <id>".`,
      );
    }
    return found;
  }

  const choices =
    action === 'add'
      ? state.catalog.filter((plugin) => !installed(plugin))
      : Object.keys(state.config.plugins).map(
          (id) => state.catalog.find((plugin) => plugin.manifest.pluginId === id) ?? id,
        );
  if (isAutoAcceptEnabled()) {
    throw new CliError(
      `Name the plugin to ${action}: armemon plugin ${action} <id>.`,
      choices.length > 0
        ? `${action === 'add' ? 'Not in this app yet' : 'In this app'}: ${choices.map((choice) => (typeof choice === 'string' ? choice : choice.manifest.pluginId)).join(', ')}.`
        : action === 'add'
          ? 'Every plugin armemon knows is already in this app.'
          : 'This app has no plugins.',
    );
  }
  if (choices.length === 0) {
    throw new CliError(action === 'add' ? 'Every plugin armemon knows is already in this app.' : 'This app has no plugins to remove.');
  }

  const id = await promptSelect<string>({
    message: action === 'add' ? 'Which plugin should be added?' : 'Which plugin should be removed?',
    options: choices.map((choice) =>
      typeof choice === 'string'
        ? { value: choice, label: choice, hint: 'not installed here' }
        : { value: choice.manifest.pluginId, label: choice.manifest.displayName, hint: choice.manifest.description },
    ),
  });
  return state.catalog.find((plugin) => plugin.manifest.pluginId === id) ?? id;
}

/** R7: refuses, with the fix, a plugin that can't work in this app. */
export async function assertCompatible(state: AppState, plugin: DiscoveredPlugin): Promise<void> {
  const { manifest } = plugin;

  if (filterPluginsByPlatform([plugin], state.platforms).length === 0) {
    throw new CliError(
      `${manifest.displayName} works on ${(manifest.platforms ?? []).join(', ')}, and this app targets ${state.platforms.join(', ')}.`,
      `Add one of those platforms first, e.g. "armemon add ${manifest.platforms?.[0] ?? 'web'}".`,
    );
  }

  const reactNative = (state.pkg.dependencies?.['react-native'] ?? state.config.rnVersion).replace(/^[^0-9]*/, '');
  const [tooNew] = partitionPluginsByReactNative([plugin], reactNative).incompatible;
  if (tooNew) {
    throw new CliError(
      `${manifest.displayName} needs React Native ${tooNew.rnMin} or newer, and this app has ${reactNative}.`,
      'Upgrade React Native in the app first.',
    );
  }

  if (!isFirstParty(plugin.packageName)) return;

  const cliLinked = isWorkspacePackage('@armemon-library/core', { resolveFrom: [CLI_DIR] });
  if (state.linkedLocally && !cliLinked) {
    throw new CliError(
      "This app links its @armemon-library packages from a source checkout, and this armemon was installed from npm — the plugin would bring a second copy of core.",
      'Run armemon from the checkout the app links to.',
    );
  }
  if (!state.linkedLocally && cliLinked) {
    throw new CliError(
      'This armemon runs from its source checkout, and this app installs @armemon-library packages from npm — the plugin would be linked by a path only this machine has.',
      'Run the published CLI instead: npx @armemon-library/cli plugin add <id>.',
    );
  }
  if (!state.linkedLocally) {
    const appCore = state.pkg.dependencies?.['@armemon-library/core'];
    const cliCore = await readPackageVersion('@armemon-library/core', [CLI_DIR]);
    if (appCore && cliCore && semver.validRange(appCore) && !semver.satisfies(cliCore, appCore)) {
      throw new CliError(
        `This app uses @armemon-library/core ${appCore}, and this armemon ships ${cliCore} — the plugin would be a version the rest of the app doesn't match.`,
        'Run "armemon upgrade" first, then add the plugin.',
      );
    }
  }
}
