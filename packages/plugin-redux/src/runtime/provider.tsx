/**
 * FILE: provider.tsx
 * PATH: packages/plugin-redux/src/runtime/provider.tsx
 *
 * WHAT: Wraps children in react-redux's Provider, plus the persist adapter's
 *       PersistGate when persistence is enabled.
 * WHY:  Whether a gate is needed at all depends on the app's config, so that branch
 *       lives in one place rather than at every call site. PersistGate comes off the
 *       injected adapter rather than being imported here, for the same
 *       bundle-resolution reason as configureStore.ts — see persistAdapter.ts.
 * HOW:  Renders the gate only when both a persistor and an adapter are present.
 * WHEN: Rendered once, by the provider returned from configureReduxPlugin().
 *
 * EXPORTS: ReduxProvider
 * DEPENDS ON: react, react-redux, ./configureStore
 * USED BY: packages/plugin-redux/src/runtime/index.tsx
 */

import React, { type ReactElement, type ReactNode } from 'react';
import { Provider as ReactReduxProvider } from 'react-redux';
import type { ConfiguredStore } from './configureStore.js';

export interface ReduxProviderProps {
  configured: ConfiguredStore;
  children: ReactNode;
}

export function ReduxProvider({ configured, children }: ReduxProviderProps): ReactElement {
  if (!configured.persistor || !configured.adapter) {
    return <ReactReduxProvider store={configured.store}>{children}</ReactReduxProvider>;
  }

  const { PersistGate } = configured.adapter;

  return (
    <ReactReduxProvider store={configured.store}>
      <PersistGate loading={null} persistor={configured.persistor}>
        {children}
      </PersistGate>
    </ReactReduxProvider>
  );
}
