/**
 * FILE: index.tsx
 * PATH: packages/plugin-redux/src/runtime/index.tsx
 *
 * WHAT: Public runtime entry point — configureReduxPlugin(config) builds a store
 *       from the app's wizard-generated config and returns a RuntimePluginObject
 *       bound to it; also re-exports react-redux's hooks and RTK's slice/thunk
 *       helpers for use in generated slice files.
 * WHY:  Unlike the static built-ins (splash, advanced-init), Redux genuinely needs
 *       per-app configuration (which slices, is persistence on) — so instead of a
 *       fixed exported object, this package exports a *factory*. The app's generated
 *       armemon/redux/index.ts glue file calls this factory with its own
 *       store.config.ts data and exports the result under the name declared in this
 *       package's manifest.runtimeExportName ("ReduxPlugin") — that's what
 *       runtime.generated.ts actually imports.
 * HOW:  buildStore() does the RTK/persist wiring; the returned provider closes over
 *       the resulting store/persistor so every render reuses the same instance.
 * WHEN: configureReduxPlugin() runs once, at module-evaluation time, inside the
 *       app's generated redux glue file.
 *
 * EXPORTS: configureReduxPlugin, ReduxPluginObject, useSelector, useDispatch, useStore, createSlice,
 *          createAsyncThunk, ReduxConfig, SliceConfig
 * DEPENDS ON: react, react-redux, @reduxjs/toolkit, @armemon-library/config-types,
 *             ./configureStore, ./provider
 * USED BY: generated armemon/redux/index.ts (in scaffolded apps)
 */

import React, { type ReactElement, type ReactNode } from 'react';
import type { RuntimePluginObject } from '@armemon-library/config-types';
import { buildStore, type ReduxConfig } from './configureStore.js';
import { ReduxProvider } from './provider.js';

/**
 * The plugin object, plus the store it built.
 *
 * The store was reachable only through react-redux's hooks, which means only from
 * inside a component. Real apps need it outside one too — an API client attaching
 * the current token, an armemon init task hydrating state before the app renders,
 * a push handler dispatching from outside the tree. Exposing what was already built
 * costs nothing and removes the reason to hand-write a store instead.
 */
export interface ReduxPluginObject extends RuntimePluginObject {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  store: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  persistor: any;
}

export function configureReduxPlugin(config: ReduxConfig): ReduxPluginObject {
  const configured = buildStore(config);

  function BoundReduxProvider({ children }: { children: ReactNode }): ReactElement {
    return <ReduxProvider configured={configured}>{children}</ReduxProvider>;
  }

  return {
    name: 'redux',
    provider: BoundReduxProvider,
    index: 10,
    tasks: [],
    store: configured.store,
    persistor: configured.persistor,
  };
}

export { useSelector, useDispatch, useStore } from 'react-redux';
// nanoid is re-exported from RTK deliberately: the standalone nanoid v5 package
// needs crypto.getRandomValues(), which Hermes doesn't provide, so generated
// slices that used it threw on first dispatch. RTK bundles an RN-safe
// implementation and is already installed.
export { createSlice, createAsyncThunk, nanoid } from '@reduxjs/toolkit';
export type { ReduxConfig, SliceConfig, ReduxPersistConfig } from './configureStore.js';
export type { PersistAdapter } from './persistTypes.js';
