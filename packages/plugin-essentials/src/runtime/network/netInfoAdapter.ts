/**
 * FILE: netInfoAdapter.ts
 * PATH: packages/plugin-essentials/src/runtime/network/netInfoAdapter.ts
 *
 * WHAT: The @react-native-community/netinfo integration, published as its own
 *       "@armemon-library/essentials/netinfo" entry point rather than as part of the
 *       main runtime.
 * WHY:  See netInfoTypes.ts — this split exists so netinfo is only reachable, and so
 *       only needs installing, when the app actually enabled network monitoring. A
 *       conditional require() would not have worked: Metro resolves every require in
 *       a reachable module at bundle time whether or not it executes, so the import
 *       has to live in a module the app never mentions.
 * HOW:  Wraps NetInfo.addEventListener/fetch into the narrow NetInfoAdapter shape.
 * WHEN: Imported by a scaffolded app's generated armemon/essentials/index.ts,
 *       only when the network sub-feature was selected.
 *
 * EXPORTS: netInfoAdapter, NetInfoAdapter
 * DEPENDS ON: @react-native-community/netinfo, ./netInfoTypes
 * USED BY: generated armemon/essentials/index.ts (in scaffolded apps)
 */

import NetInfo from '@react-native-community/netinfo';
import type { NetInfoAdapter } from './netInfoTypes.js';

export type { NetInfoAdapter, NetInfoSnapshot } from './netInfoTypes.js';

export const netInfoAdapter: NetInfoAdapter = {
  subscribe: (listener) =>
    NetInfo.addEventListener((state) =>
      listener({
        isConnected: state.isConnected,
        isInternetReachable: state.isInternetReachable,
      }),
    ),
  fetch: async () => {
    const state = await NetInfo.fetch();
    return {
      isConnected: state.isConnected,
      isInternetReachable: state.isInternetReachable,
    };
  },
};
