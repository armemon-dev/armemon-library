/**
 * FILE: provider.tsx
 * PATH: packages/plugin-essentials/src/runtime/loading/provider.tsx
 *
 * WHAT: Global loading/error overlay state and the useLoading() hook.
 * WHY:  Gives screens a single shared "show a blocking loading/error overlay"
 *       mechanism instead of every screen building its own.
 * HOW:  Plain useState-backed context. showError() also clears isLoading, since an
 *       operation that errored is by definition no longer in flight — leaving both
 *       set was the documented "callers are expected to clean up" caveat, and
 *       expecting every caller to remember is how a spinner ends up stuck behind an
 *       error dialog. The overlay renders whichever state is set, error winning.
 * WHEN: Mounted once by configureEssentialsPlugin()'s provider; read via
 *       useLoading() by any app screen.
 *
 * EXPORTS: LoadingProvider, useLoading, LoadingContextValue
 * DEPENDS ON: react, ../config, ./components/LoadingOverlay
 * USED BY: packages/plugin-essentials/src/runtime/index.tsx
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { LoadingConfig } from '../config.js';
import { LoadingOverlay } from './components/LoadingOverlay.js';

export interface LoadingContextValue {
  isLoading: boolean;
  error: Error | null;
  showLoading: () => void;
  hideLoading: () => void;
  showError: (error: Error) => void;
  clearError: () => void;
}

const LoadingContext = createContext<LoadingContextValue | null>(null);

export interface LoadingProviderProps {
  config: LoadingConfig;
  children: ReactNode;
}

export function LoadingProvider({ config, children }: LoadingProviderProps): ReactElement {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const showLoading = useCallback(() => setIsLoading(true), []);
  const hideLoading = useCallback(() => setIsLoading(false), []);
  const showError = useCallback((err: Error) => {
    setIsLoading(false);
    setError(err);
  }, []);
  const clearError = useCallback(() => setError(null), []);

  const value = useMemo<LoadingContextValue>(
    () => ({ isLoading, error, showLoading, hideLoading, showError, clearError }),
    [isLoading, error, showLoading, hideLoading, showError, clearError],
  );

  return (
    <LoadingContext.Provider value={value}>
      {children}
      {config.enabled && (isLoading || error) ? (
        <LoadingOverlay style={config.style} error={error} onDismissError={clearError} />
      ) : null}
    </LoadingContext.Provider>
  );
}

export function useLoading(): LoadingContextValue {
  const ctx = useContext(LoadingContext);
  if (!ctx) {
    throw new Error('useLoading() must be used within the armemon Essentials plugin provider.');
  }
  return ctx;
}
