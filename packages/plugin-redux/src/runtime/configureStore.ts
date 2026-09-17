/**
 * FILE: configureStore.ts
 * PATH: packages/plugin-redux/src/runtime/configureStore.ts
 *
 * WHAT: Builds a Redux Toolkit store from a plain config object. Supports two slice
 *       authoring modes: a plain {name, initialState, reducers} shape (auto-passed
 *       to createSlice) for simple sync-only slices, or a pre-built createSlice()
 *       result (detected by the presence of a `.reducer` function) for slices that
 *       need extraReducers to hook into createAsyncThunk lifecycle actions. The root
 *       reducer is wrapped with redux-persist only when the caller supplies a
 *       persist adapter.
 * WHY:  Sync-only slices are simplest as plain config objects; anything using
 *       createAsyncThunk needs extraReducers, which the plain shape can't express —
 *       supporting both means generated templates can pick whichever fits.
 *
 *       Persistence arrives as an INJECTED adapter rather than a direct import, so
 *       this module has no module edge to redux-persist or AsyncStorage. See
 *       persistAdapter.ts: importing them here made the bundle fail outright for
 *       every app that declined persistence, because Metro resolves imports whether
 *       or not they execute.
 * HOW:  Loosely typed against RTK's own (famously hard to hand-annotate) generics —
 *       correctness matters more than perfect inference, and ReduxConfig/SliceConfig
 *       are what callers actually touch.
 * WHEN: Called once by configureReduxPlugin() when the app's redux glue file
 *       constructs its plugin instance.
 *
 * EXPORTS: buildStore, ReduxConfig, SliceConfig, PrebuiltSlice, ReduxPersistConfig,
 *          ConfiguredStore
 * DEPENDS ON: @reduxjs/toolkit, ./persistTypes
 * USED BY: packages/plugin-redux/src/runtime/index.tsx
 */

import { configureStore, createSlice, combineReducers } from '@reduxjs/toolkit';
import type { PersistAdapter } from './persistTypes.js';

// react-native's own types declare __DEV__ globally, but only once something in this
// compilation unit imports from 'react-native' directly — this file never does, so
// the ambient declaration never loads. Declaring it locally is the minimal fix.
declare const __DEV__: boolean;

export interface SliceConfig {
  name: string;
  initialState: unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  reducers: Record<string, (state: any, action: any) => void>;
}

export interface PrebuiltSlice {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  reducer: (state: any, action: any) => any;
}

function isPrebuiltSlice(value: SliceConfig | PrebuiltSlice): value is PrebuiltSlice {
  return typeof (value as PrebuiltSlice).reducer === 'function';
}

export interface ReduxPersistConfig {
  enabled?: boolean;
  key?: string;
  whitelist?: string[];
  blacklist?: string[];
  version?: number;
  /**
   * Supplied by the app's generated glue file via
   * `import { persistAdapter } from '@armemon-library/redux/persist'`. Required
   * whenever `enabled` is true — without it there is nothing to persist WITH.
   */
  adapter?: PersistAdapter;
}

export interface ReduxConfig {
  slices?: Record<string, SliceConfig | PrebuiltSlice>;
  middleware?: (defaultMiddleware: unknown[]) => unknown[];
  persist?: ReduxPersistConfig;
  devTools?: boolean;
}

export interface ConfiguredStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  store: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  persistor: any;
  adapter?: PersistAdapter;
}

/** combineReducers({}) warns and yields a store nothing can ever change. */
const NOOP_REDUCER = { __armemon: () => null };

export function buildStore(config: ReduxConfig): ConfiguredStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sliceReducers: Record<string, any> = {};

  for (const [key, sliceConfig] of Object.entries(config.slices ?? {})) {
    if (isPrebuiltSlice(sliceConfig)) {
      sliceReducers[key] = sliceConfig.reducer;
      continue;
    }

    const slice = createSlice({
      name: sliceConfig.name,
      initialState: sliceConfig.initialState,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      reducers: sliceConfig.reducers as any,
    });
    sliceReducers[key] = slice.reducer;
  }

  const hasSlices = Object.keys(sliceReducers).length > 0;
  const rootReducer = combineReducers(hasSlices ? sliceReducers : NOOP_REDUCER);

  const persistEnabled = config.persist?.enabled ?? false;
  const adapter = config.persist?.adapter;

  if (persistEnabled && !adapter) {
    throw new Error(
      'armemon Redux: persist.enabled is true but no persist adapter was provided. Add `import { persistAdapter } from "@armemon-library/redux/persist"` and pass it as `persist.adapter` in armemon/redux/store.config.ts.',
    );
  }

  const usePersist = persistEnabled && adapter !== undefined;

  const reducer = usePersist
    ? adapter.persistReducer(
        {
          key: config.persist?.key ?? 'root',
          whitelist: config.persist?.whitelist,
          blacklist: config.persist?.blacklist,
          version: config.persist?.version ?? 1,
        },
        rootReducer,
      )
    : rootReducer;

  const store = configureStore({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    reducer: reducer as any,
    middleware: (getDefaultMiddleware) => {
      const base = getDefaultMiddleware(
        usePersist ? { serializableCheck: { ignoredActions: adapter.ignoredActions } } : undefined,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (config.middleware ? config.middleware(base as unknown[]) : base) as any;
    },
    devTools: config.devTools ?? __DEV__,
  });

  const persistor = usePersist ? adapter.persistStore(store) : null;

  return { store, persistor, adapter };
}
