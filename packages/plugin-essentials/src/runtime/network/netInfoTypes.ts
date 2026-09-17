/**
 * FILE: netInfoTypes.ts
 * PATH: packages/plugin-essentials/src/runtime/network/netInfoTypes.ts
 *
 * WHAT: The NetInfoAdapter interface — the two things NetworkProvider needs from
 *       @react-native-community/netinfo, expressed without importing it.
 * WHY:  Types only, in their own file, so the provider can be typed against
 *       connectivity monitoring without creating a module edge to netinfo. That edge
 *       is what broke the bundle for anyone who deselected the "network" sub-feature:
 *       the wizard stopped installing netinfo, but the runtime imported it anyway, so
 *       Metro failed with "Unable to resolve module @react-native-community/netinfo"
 *       — from a choice the sub-feature multiselect explicitly offered.
 * HOW:  Plain interface over the subscribe/fetch surface, deliberately narrower than
 *       netinfo's own NetInfoState.
 * WHEN: Imported as a type by provider.tsx and netInfoAdapter.ts.
 *
 * EXPORTS: NetInfoAdapter, NetInfoSnapshot
 * DEPENDS ON: nothing
 * USED BY: packages/plugin-essentials/src/runtime/network/*
 */

export interface NetInfoSnapshot {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
}

export interface NetInfoAdapter {
  /** Returns an unsubscribe function. Fires immediately with current state. */
  subscribe(listener: (state: NetInfoSnapshot) => void): () => void;
  /** One-shot read, used by the optional polling fallback. */
  fetch(): Promise<NetInfoSnapshot>;
}
