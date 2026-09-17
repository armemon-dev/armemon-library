/**
 * FILE: persistAdapter.ts
 * PATH: packages/plugin-redux/src/runtime/persistAdapter.ts
 *
 * WHAT: The redux-persist + AsyncStorage integration, published as its own
 *       "@armemon-library/redux/persist" entry point rather than as part of the main
 *       runtime.
 * WHY:  This split exists because of a hard bundling failure, not for tidiness. The
 *       main runtime used to import redux-persist, redux-persist/integration/react
 *       and @react-native-async-storage/async-storage at module top level, while the
 *       wizard only INSTALLED those three when the user said yes to persistence.
 *       Answer "no" and Metro fails the bundle with "Unable to resolve module
 *       redux-persist" before the app boots. A conditional `require()` would not have
 *       helped: Metro resolves every require in a reachable module at bundle time,
 *       whether or not it ever executes. The only real fix is for the import to live
 *       in a module that isn't reachable at all unless persistence is on — which is
 *       what a separate entry point gives us. Apps with persistence enabled import
 *       this; apps without it never mention it, so its dependencies are never
 *       resolved and never need to be installed.
 * HOW:  Re-exports the pieces buildStore() needs behind one PersistAdapter object,
 *       so the main runtime depends on a plain interface and never on the packages.
 * WHEN: Imported by a scaffolded app's generated armemon/redux/index.ts, only
 *       when the wizard's persistence question was answered yes.
 *
 * EXPORTS: persistAdapter, PersistAdapter
 * DEPENDS ON: redux-persist, redux-persist/integration/react, @react-native-async-storage/async-storage
 * USED BY: generated armemon/redux/index.ts (in scaffolded apps)
 */

import {
  persistStore,
  persistReducer,
  FLUSH,
  REHYDRATE,
  PAUSE,
  PERSIST,
  PURGE,
  REGISTER,
} from 'redux-persist';
import { PersistGate } from 'redux-persist/integration/react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PersistAdapter } from './persistTypes.js';

export type { PersistAdapter } from './persistTypes.js';

export const persistAdapter: PersistAdapter = {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  persistReducer: (config, reducer) =>
    persistReducer({ ...(config as any), storage: AsyncStorage } as any, reducer as any) as any,
  persistStore: (store) => persistStore(store as any),
  PersistGate: PersistGate as any,
  /* eslint-enable @typescript-eslint/no-explicit-any */
  ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER],
};
