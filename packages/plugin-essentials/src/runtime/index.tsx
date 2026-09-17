/**
 * FILE: index.tsx
 * PATH: packages/plugin-essentials/src/runtime/index.tsx
 *
 * WHAT: Public runtime entry point — configureEssentialsPlugin(config) composes the
 *       three sub-feature providers (notifications, network, loading) into one
 *       RuntimePluginObject; also re-exports each sub-feature's hook.
 * WHY:  Same factory pattern as the other configurable plugins. Bundling three
 *       sub-features into one plugin (rather than three separate plugins) matches
 *       how the wizard presents them — one "Essentials" checkbox entry with an
 *       internal multiselect for which sub-features to actually enable.
 * HOW:  resolveEssentialsConfig (./config) turns the options into a full config and
 *       decides whether the network check is on; this file only wires the providers.
 *       Nesting order (Notifications > Network > Loading) is arbitrary since the three
 *       sub-features don't depend on each other.
 * WHEN: configureEssentialsPlugin() runs once, at module-evaluation time — in the
 *       app's generated essentials glue file, or in the setup file of an app that
 *       uses the package without the CLI.
 *
 * EXPORTS: configureEssentialsPlugin, useNotifications, useNetworkStatus,
 *          useLoading, EssentialsConfig, EssentialsPluginOptions
 * DEPENDS ON: react, @armemon-library/config-types, ./config, ./notifications/provider,
 *             ./network/provider, ./loading/provider
 * USED BY: generated armemon/essentials/index.ts, or an app's own setup file
 */

import React, { type ReactElement, type ReactNode } from 'react';
import type { RuntimePluginObject } from '@armemon-library/config-types';
import { resolveEssentialsConfig, type EssentialsPluginOptions } from './config.js';
import { NotificationsProvider } from './notifications/provider.js';
import { NetworkProvider } from './network/provider.js';
import { LoadingProvider } from './loading/provider.js';

export function configureEssentialsPlugin(
  config: EssentialsPluginOptions = {},
): RuntimePluginObject {
  // Resolved here, at module-evaluation time, so a misconfiguration fails on start
  // rather than the first time a screen asks for network status.
  const merged = resolveEssentialsConfig(config);

  function BoundEssentialsProvider({ children }: { children: ReactNode }): ReactElement {
    return (
      <NotificationsProvider config={merged.notifications}>
        <NetworkProvider config={merged.network} adapter={config.netInfoAdapter}>
          <LoadingProvider config={merged.loading}>{children}</LoadingProvider>
        </NetworkProvider>
      </NotificationsProvider>
    );
  }

  return {
    name: 'essentials',
    provider: BoundEssentialsProvider,
    index: 0,
    tasks: [],
  };
}

export { useNotifications } from './notifications/provider.js';
export { useNetworkStatus } from './network/provider.js';
export { useLoading } from './loading/provider.js';
export type { EssentialsConfig, EssentialsPluginOptions } from './config.js';
export type { NetInfoAdapter, NetInfoSnapshot } from './network/netInfoTypes.js';
