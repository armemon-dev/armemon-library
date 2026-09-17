/**
 * FILE: config.ts
 * PATH: packages/plugin-essentials/src/runtime/config.ts
 *
 * WHAT: The EssentialsConfig shape (one section per sub-feature), its defaults, and
 *       resolveEssentialsConfig() — the one place options become a full config.
 * WHY:  Each sub-feature (notifications/network/loading) has its own independent
 *       config section, matching the reference kit-old's per-feature config
 *       convention rather than one flat object — makes it obvious which settings
 *       belong to which sub-feature.
 *
 *       The resolver lives here rather than in index.tsx because this file imports no
 *       React Native, so the rules can be tested directly. The runtime entry can't be
 *       loaded in Node at all.
 * HOW:  Plain interfaces; resolveEssentialsConfig() deep-merges partial options against
 *       DEFAULT_ESSENTIALS_CONFIG per section, and decides whether the network check
 *       is on.
 * WHEN: Read once by configureEssentialsPlugin() at module-evaluation time.
 *
 * EXPORTS: NotificationsConfig, NetworkConfig, LoadingConfig, EssentialsConfig,
 *          EssentialsPluginOptions, DEFAULT_ESSENTIALS_CONFIG, resolveEssentialsConfig
 * DEPENDS ON: ./network/netInfoTypes (types only)
 * USED BY: packages/plugin-essentials/src/runtime/index.tsx and every sub-feature provider
 */

import type { NetInfoAdapter } from './network/netInfoTypes.js';

export interface NotificationsConfig {
  enabled: boolean;
  defaultDelay: number;
  position: 'top' | 'bottom';
  swipeable: boolean;
  /** Cap on retained history entries; the oldest are dropped past this. */
  historyLimit: number;
}

export interface NetworkConfig {
  enabled: boolean;
  mode: 'internet' | 'connection';
  polling: boolean;
  pollInterval: number;
  showOfflineBanner: boolean;
}

export interface LoadingConfig {
  enabled: boolean;
  style: 'progressbar' | 'spinner' | 'blank';
}

export interface EssentialsConfig {
  notifications: NotificationsConfig;
  network: NetworkConfig;
  loading: LoadingConfig;
}

export const DEFAULT_ESSENTIALS_CONFIG: EssentialsConfig = {
  notifications: {
    enabled: true,
    defaultDelay: 3000,
    position: 'top',
    swipeable: true,
    historyLimit: 100,
  },
  network: {
    // Off here, and decided by resolveEssentialsConfig: the check needs NetInfo, an
    // optional package, so it is on only when an adapter is given.
    enabled: false,
    mode: 'internet',
    polling: false,
    pollInterval: 10000,
    showOfflineBanner: true,
  },
  loading: { enabled: true, style: 'progressbar' },
};

/**
 * Partial per group, not just at the top level.
 *
 * The groups are merged field by field, so `{ network: { enabled: true } }` is a
 * complete thing to write. The type used to be `Partial<EssentialsConfig>`, which is
 * shallow: it demanded every field of `network` the moment you set one.
 */
export interface EssentialsPluginOptions {
  notifications?: Partial<NotificationsConfig>;
  network?: Partial<NetworkConfig>;
  loading?: Partial<LoadingConfig>;
  /**
   * `import { netInfoAdapter } from '@armemon-library/essentials/netinfo'`. That
   * import is the single thing that pulls @react-native-community/netinfo into the
   * bundle, so leaving it out is what keeps an app free of it.
   */
  netInfoAdapter?: NetInfoAdapter;
}

/**
 * Options in, full config out.
 *
 * The network check is on when the app says so, and otherwise exactly when an adapter
 * was given. It used to default to on, which meant `configureEssentialsPlugin()` with
 * no arguments threw at startup in any app that hadn't installed the optional NetInfo
 * package — the first thing anyone trying the package on its own would write.
 *
 * Asking for the check explicitly without an adapter still fails loudly: that is a
 * request armemon cannot honour, not a default it guessed.
 */
export function resolveEssentialsConfig(options: EssentialsPluginOptions = {}): EssentialsConfig {
  const networkEnabled = options.network?.enabled ?? options.netInfoAdapter !== undefined;

  const resolved: EssentialsConfig = {
    notifications: { ...DEFAULT_ESSENTIALS_CONFIG.notifications, ...options.notifications },
    network: { ...DEFAULT_ESSENTIALS_CONFIG.network, ...options.network, enabled: networkEnabled },
    loading: { ...DEFAULT_ESSENTIALS_CONFIG.loading, ...options.loading },
  };

  if (resolved.network.enabled && !options.netInfoAdapter) {
    throw new Error(
      'armemon Essentials: network.enabled is true but no NetInfo adapter was provided. Pass one — import { netInfoAdapter } from "@armemon-library/essentials/netinfo", then configureEssentialsPlugin({ netInfoAdapter }) (in an app made by the armemon CLI, that call is in armemon/essentials/index.ts). Or leave network.enabled out and the check stays off.',
    );
  }

  return resolved;
}
