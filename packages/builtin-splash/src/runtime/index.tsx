/**
 * FILE: index.tsx
 * PATH: packages/builtin-splash/src/runtime/index.tsx
 *
 * WHAT: configureSplashPlugin(config) — the splash plugin, built around a `hide`
 *       function the app supplies rather than a native module this package imports.
 * WHY:  One splash definition, every platform. The same background colour and logo
 *       drive three different renderings, because "splash screen" means three
 *       different mechanisms:
 *         - iOS/Android: a real cold-start splash, drawn by the OS from assets
 *           react-native-bootsplash generated, before any JavaScript runs.
 *         - Web: static markup in index.html, visible the moment the page paints
 *           and removed once React mounts — the closest thing the web has.
 *         - Everywhere (incl. Windows/macOS): core's splash screen, shown while
 *           init tasks run, styled from the same config so it matches.
 *
 *       `hide` is INJECTED rather than imported because react-native-bootsplash
 *       calls TurboModuleRegistry.getEnforcing at import time and has no web
 *       implementation. Importing it here would put it in every bundle, including
 *       the web one. The app's generated glue supplies a platform-specific hide via
 *       `hide.ts` / `hide.web.ts`, which Metro and Vite each resolve to the right
 *       file — so a single plugin serves both without either bundler seeing the
 *       other's dependency. Same reasoning as @armemon-library/redux/persist.
 * HOW:  A provider that calls `hide` once on mount. By then KitProvider has already
 *       finished the init phases, so "kit is ready" and "take the splash down" are
 *       the same moment by construction.
 * WHEN: configureSplashPlugin() runs at module-evaluation time in the app's
 *       generated armemon/splash/index.ts.
 *
 * EXPORTS: configureSplashPlugin, SplashPluginConfig
 * DEPENDS ON: react, @armemon-library/config-types
 * USED BY: generated armemon/splash/index.ts (in scaffolded apps)
 */

import React, { useEffect, type ReactElement, type ReactNode } from 'react';
import type { RuntimePluginObject } from '@armemon-library/config-types';

export interface SplashPluginConfig {
  /**
   * Takes the platform's splash down. Native hides the bootsplash view; web removes
   * the static element from index.html. Never throws out: a splash that was never
   * shown (a debug build without the native wiring, a hot reload) is normal.
   */
  hide: () => void | Promise<void>;
}

export function configureSplashPlugin(config: SplashPluginConfig): RuntimePluginObject {
  function SplashHideProvider({ children }: { children: ReactNode }): ReactElement {
    useEffect(() => {
      void Promise.resolve()
        .then(() => config.hide())
        .catch(() => {});
    }, []);

    return <>{children}</>;
  }

  return {
    name: 'splash',
    provider: SplashHideProvider,
    // Outermost: the splash wraps everything, since taking it down is the very
    // first thing the composed tree does.
    index: -100,
    tasks: [],
  };
}
