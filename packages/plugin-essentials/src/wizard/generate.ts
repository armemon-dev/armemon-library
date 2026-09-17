/**
 * FILE: generate.ts
 * PATH: packages/plugin-essentials/src/wizard/generate.ts
 *
 * WHAT: Turns EssentialsAnswers into a PluginInstallPlan — writes
 *       essentials.config.ts (plain data, `enabled` flags per section derived from
 *       which sub-features were selected) and the per-app glue file calling
 *       configureEssentialsPlugin().
 * WHY:  Same glue-file pattern as the other configurable plugins.
 * HOW:  No external template files needed — content is small enough to inline.
 * WHEN: Called once by the wizard's plan() step, after askEssentialsQuestions()
 *       resolves.
 *
 * EXPORTS: planEssentials
 * DEPENDS ON: @armemon-library/config-types, ./questions
 */

import { layoutOf, managedFile, type PluginInstallPlan, type WizardContext } from '@armemon-library/config-types';
import type { EssentialsAnswers } from './questions.js';

export async function planEssentials(
  answers: EssentialsAnswers,
  ctx: WizardContext,
): Promise<PluginInstallPlan> {
  const layout = layoutOf(ctx);
  const npmDependencies: Record<string, string> = { ...answers.dependencyVersions };
  const networkEnabled = answers.subFeatures.includes('network');

  // The adapter import is what pulls netinfo into the bundle, so it appears only
  // when the sub-feature is on — see plugin-essentials/src/runtime/network/
  // netInfoAdapter.ts for why importing it unconditionally broke the build for
  // anyone who turned network monitoring off.
  const adapterImport = networkEnabled
    ? "import { netInfoAdapter } from '@armemon-library/essentials/netinfo';\n"
    : '';
  const adapterField = networkEnabled ? '\n  netInfoAdapter,' : '';

  const filesToWrite: PluginInstallPlan['filesToWrite'] = [
    {
      path: managedFile.essentialsConfig(layout),
      content: `import type { EssentialsConfig } from '@armemon-library/essentials';

/**
 * Toasts, connectivity and the loading overlay.
 *
 * Every option is below with what it does. Change a value and reload — none of this
 * needs a rebuild of anything native.
 */
export const essentialsConfig: EssentialsConfig = {
  // ---------------------------------------------------------------------------
  // notifications — a toast stack rendered above your whole app.
  //
  //   enabled       render the stack at all (false = useNotifications() still
  //                 works, nothing is drawn, useful if you supply your own UI)
  //   defaultDelay  ms before a toast auto-dismisses; 0 means it stays until
  //                 dismissed by hand
  //   position      'top' | 'bottom'
  //   swipeable     tap a toast to dismiss it early
  //   historyLimit  how many past toasts to keep for useNotifications().history;
  //                 the oldest are dropped past this
  //
  // Showing one from anywhere:
  //   const { notify } = useNotifications();
  //   notify({ message: 'Saved', type: 'success' });
  //   notify({ message: 'Could not save', type: 'error', delay: 0 });
  //
  // types: 'success' | 'error' | 'info' | 'warning'
  // notify() returns the id, so you can dismiss(id) it yourself later.
  // Also available: clear(), markRead(id), clearHistory(), and \`queue\`/\`history\`.
  // ---------------------------------------------------------------------------
  notifications: {
    enabled: ${answers.subFeatures.includes('notifications')},
    defaultDelay: ${answers.toastDelay},
    position: '${answers.toastPosition}',
    swipeable: ${answers.toastSwipeable},
    historyLimit: ${answers.historyLimit},
  },

  // ---------------------------------------------------------------------------
  // network — connectivity tracking, plus an optional offline banner.
  //
  //   enabled            track connectivity at all
  //   mode               'internet'   — online means the internet is actually
  //                                     reachable (slower, accurate; a captive
  //                                     wifi portal counts as offline)
  //                      'connection' — online means an interface is up (instant,
  //                                     but says online on a dead hotspot)
  //   polling            also poll on an interval, not just react to events. Only
  //                      needed on networks where change events are unreliable.
  //   pollInterval       ms between polls when polling is on
  //   showOfflineBanner  render armemon's red banner automatically. Turn off to
  //                      build your own from useNetworkStatus().
  //
  // Reading it:
  //   const { isOnline, isConnected, isInternetReachable } = useNetworkStatus();
  //
  // isInternetReachable can be null — "not determined yet", which is not the same
  // as offline. \`isOnline\` already resolves that for you per the mode above.
  //
  // Turning this off means removing the netInfoAdapter import from ./index too,
  // or @react-native-community/netinfo is still bundled.
  // ---------------------------------------------------------------------------
  network: {
    enabled: ${networkEnabled},
    mode: '${answers.networkMode}',
    polling: ${answers.networkPolling},
    pollInterval: ${answers.pollInterval},
    showOfflineBanner: ${answers.showOfflineBanner},
  },

  // ---------------------------------------------------------------------------
  // loading — one app-wide blocking overlay, so screens don't each build their own.
  //
  //   enabled  render the overlay
  //   style    'progressbar' — dimmed background with a spinner
  //            'spinner'     — spinner only
  //            'blank'       — dim only, no spinner
  //
  // Using it:
  //   const { showLoading, hideLoading, showError, clearError } = useLoading();
  //   showLoading();
  //   try { await save(); } finally { hideLoading(); }
  //
  //   showError(new Error('Could not reach the server'));
  //
  // showError also clears the loading state, so an operation that failed never
  // leaves a spinner stuck behind the message. The overlay captures touches while
  // visible — that is the point of it.
  // ---------------------------------------------------------------------------
  loading: {
    enabled: ${answers.subFeatures.includes('loading')},
    style: '${answers.loadingStyle}',
  },
};
`,
    },
    {
      path: managedFile.essentialsGlue(layout),
      content: `import { configureEssentialsPlugin } from '@armemon-library/essentials';
${adapterImport}import { essentialsConfig } from './essentials.config';

/**
 * Glue file: turns ./essentials.config into the plugin object armemon.config
 * registers. Change behaviour in ./essentials.config — this file only assembles it.
 *${
  adapterField
    ? `
 * netInfoAdapter is what pulls @react-native-community/netinfo into the bundle. It
 * is passed separately, from its own entry point, so an app without the network
 * feature never bundles the package at all. Leave it unless you are removing the
 * network feature entirely.
 *`
    : ''
}
 * WHAT THIS PLUGIN GIVES YOU — three hooks, all imported from
 * '@armemon-library/essentials'. Each one's options are documented where they are
 * set, in ./essentials.config, so there is only ever one description to trust:
 *
 *   useNotifications()
 *     { notify, dismiss, clear, markRead, clearHistory, queue, history }
 *     notify({ message: 'Saved', type: 'success' }) -> the new toast's id
 *
 *   useNetworkStatus()
 *     { isConnected, isInternetReachable, isOnline }
 *     isInternetReachable can be null — not determined yet, which is not offline.
 *
 *   useLoading()
 *     { isLoading, error, showLoading, hideLoading, showError, clearError }
 *
 * Turning a feature off in essentials.config does not remove its hook: the hook
 * keeps working and only the UI stops — notify() records a toast that isn't drawn,
 * showLoading() sets state with no overlay, and useNetworkStatus() stops receiving
 * updates because nothing subscribes. Calling a hook outside the app tree is the
 * one case that throws, with a message naming the hook.
 */
export const EssentialsPlugin = configureEssentialsPlugin({
  ...essentialsConfig,${adapterField}
});
`,
    },
  ];

  return {
    npmDependencies,
    filesToWrite,
    appEntryContributions: {
      providerImport: { importName: 'EssentialsPlugin', from: './essentials/index' },
      registerInRuntimeConfig: true,
    },
  };
}
