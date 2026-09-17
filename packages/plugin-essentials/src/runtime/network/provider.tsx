/**
 * FILE: provider.tsx
 * PATH: packages/plugin-essentials/src/runtime/network/provider.tsx
 *
 * WHAT: Turns a NetInfoAdapter's event stream into a simple
 *       {isConnected, isInternetReachable, isOnline} context, plus an optional
 *       auto-shown offline banner.
 * WHY:  `isOnline` is the field most app code actually wants — it resolves the
 *       'internet' vs 'connection' mode ambiguity once here instead of every screen
 *       re-deriving it. The adapter is injected rather than imported so this module
 *       has no edge to netinfo; see netInfoAdapter.ts for why that mattered.
 * HOW:  Subscribes on mount and, when polling is enabled, also fetches on an
 *       interval and applies the RESULT directly — the old version called
 *       NetInfo.fetch() and threw the value away, trusting that fetch would notify
 *       the event listener, which it does not reliably do. Without an adapter the
 *       provider is a transparent pass-through reporting "online", so an app that
 *       disabled network monitoring still renders correctly.
 * WHEN: Mounted once by configureEssentialsPlugin()'s provider; read via
 *       useNetworkStatus().
 *
 * EXPORTS: NetworkProvider, useNetworkStatus, NetworkStatus
 * DEPENDS ON: react, react-native, ../config, ./components/OfflineBanner, ./netInfoTypes
 * USED BY: packages/plugin-essentials/src/runtime/index.tsx
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { View, StyleSheet } from 'react-native';
import type { NetworkConfig } from '../config.js';
import { OfflineBanner } from './components/OfflineBanner.js';
import type { NetInfoAdapter, NetInfoSnapshot } from './netInfoTypes.js';

export interface NetworkStatus {
  isConnected: boolean;
  isInternetReachable: boolean | null;
  isOnline: boolean;
}

const OPTIMISTIC: NetworkStatus = {
  isConnected: true,
  isInternetReachable: null,
  isOnline: true,
};

const NetworkContext = createContext<NetworkStatus | null>(null);

export interface NetworkProviderProps {
  config: NetworkConfig;
  adapter?: NetInfoAdapter;
  children: ReactNode;
}

export function NetworkProvider({ config, adapter, children }: NetworkProviderProps): ReactElement {
  const [status, setStatus] = useState<NetworkStatus>(OPTIMISTIC);

  const apply = useCallback(
    (snapshot: NetInfoSnapshot) => {
      const isConnected = snapshot.isConnected ?? false;
      const isInternetReachable = snapshot.isInternetReachable;
      // A null reachability means "not determined yet", which is not the same as
      // offline — treating it as offline flashes the banner on every cold start.
      const isOnline =
        config.mode === 'internet' ? isInternetReachable !== false && isConnected : isConnected;
      setStatus({ isConnected, isInternetReachable, isOnline });
    },
    [config.mode],
  );

  const active = config.enabled && adapter !== undefined;

  useEffect(() => {
    if (!active || !adapter) return undefined;

    const unsubscribe = adapter.subscribe(apply);

    let interval: ReturnType<typeof setInterval> | undefined;
    if (config.polling) {
      interval = setInterval(() => {
        // Apply the fetched value directly: fetch() is not guaranteed to notify
        // subscribers, so the previous `void NetInfo.fetch()` was a no-op poll.
        adapter.fetch().then(apply, () => {});
      }, Math.max(1000, config.pollInterval));
    }

    return () => {
      unsubscribe();
      if (interval) clearInterval(interval);
    };
  }, [active, adapter, apply, config.polling, config.pollInterval]);

  const value = useMemo(() => (active ? status : OPTIMISTIC), [active, status]);
  const showBanner = active && config.showOfflineBanner && !status.isOnline;

  return (
    <NetworkContext.Provider value={value}>
      {/* A column wrapper so the banner reliably sits above the app and the app
          still fills the rest — as bare siblings of a context provider these two
          depended on whatever happened to be above them in the tree. */}
      <View style={styles.root}>
        {showBanner ? <OfflineBanner /> : null}
        <View style={styles.content}>{children}</View>
      </View>
    </NetworkContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'column' },
  content: { flex: 1 },
});

export function useNetworkStatus(): NetworkStatus {
  const ctx = useContext(NetworkContext);
  if (!ctx) {
    throw new Error('useNetworkStatus() must be used within the armemon Essentials plugin provider.');
  }
  return ctx;
}
