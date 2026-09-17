/**
 * FILE: ErrorBoundary.tsx
 * PATH: packages/core/src/provider/ErrorBoundary.tsx
 *
 * WHAT: A class error boundary that catches anything thrown while rendering the
 *       provider chain or the app below it, and hands it to KitProvider's configured
 *       error screen.
 * WHY:  Without this, `ErrorScreenComponent` only ever caught an orchestrate()
 *       rejection. Everything else bypassed it entirely and produced a raw red
 *       screen: getRuntimeConfig() throwing because runtime.generated wasn't
 *       imported, registerPlugins() throwing on a malformed plugin, a plugin's own
 *       provider throwing on bad config, or any screen in the app. Those first two
 *       throws are deliberate, with carefully written messages — messages nobody saw,
 *       because a throw during render is not something a try/catch or a promise
 *       handler can reach. Only a boundary can.
 * HOW:  The one thing React still requires a class for. getDerivedStateFromError
 *       records the error; componentDidCatch logs it with the component stack, which
 *       is the part that actually identifies which plugin failed.
 * WHEN: Wrapped around everything KitProvider renders, including KitProvider's own
 *       body, so a config error during its first render is caught too.
 *
 * EXPORTS: KitErrorBoundary
 * DEPENDS ON: react
 * USED BY: packages/core/src/provider/KitProvider.tsx
 */

import React, { Component, type ComponentType, type ErrorInfo, type ReactNode } from 'react';

export interface KitErrorBoundaryProps {
  fallback: ComponentType<{ error: Error }>;
  /** Notified so the host can log or report; must not throw. */
  onError?: (error: Error, info: ErrorInfo) => void;
  children: ReactNode;
}

interface KitErrorBoundaryState {
  error: Error | null;
}

export class KitErrorBoundary extends Component<KitErrorBoundaryProps, KitErrorBoundaryState> {
  state: KitErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): KitErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[armemon] Render error:', error, info.componentStack);
    try {
      this.props.onError?.(error, info);
    } catch {
      // A reporting hook must never replace the error it was reporting.
    }
  }

  render(): ReactNode {
    const { error } = this.state;
    if (error) {
      const Fallback = this.props.fallback;
      return <Fallback error={error} />;
    }
    return this.props.children;
  }
}
