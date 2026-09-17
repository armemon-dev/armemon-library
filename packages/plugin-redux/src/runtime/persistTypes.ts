/**
 * FILE: persistTypes.ts
 * PATH: packages/plugin-redux/src/runtime/persistTypes.ts
 *
 * WHAT: The PersistAdapter interface — the shape the main runtime needs from
 *       redux-persist, expressed without importing it.
 * WHY:  Types only, in their own file, so buildStore() and the provider can be typed
 *       against persistence without either of them creating a module edge to
 *       redux-persist. That edge is exactly what broke the bundle for apps that
 *       declined persistence (see persistAdapter.ts).
 * HOW:  Plain interface. Deliberately loose against redux-persist's own generics,
 *       which are hard to hand-annotate precisely and add nothing here.
 * WHEN: Imported as a type by configureStore.ts, provider.tsx and persistAdapter.ts.
 *
 * EXPORTS: PersistAdapter, PersistReducerConfig
 * DEPENDS ON: react
 * USED BY: packages/plugin-redux/src/runtime/*
 */

import type { ComponentType, ReactNode } from 'react';

export interface PersistReducerConfig {
  key: string;
  version?: number;
  whitelist?: string[];
  blacklist?: string[];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface PersistAdapter {
  persistReducer: (config: PersistReducerConfig, reducer: any) => any;
  persistStore: (store: any) => any;
  PersistGate: ComponentType<{ loading?: ReactNode; persistor: any; children?: ReactNode }>;
  /** redux-persist's non-serializable lifecycle actions, for the serializableCheck. */
  ignoredActions: string[];
}
/* eslint-enable @typescript-eslint/no-explicit-any */
