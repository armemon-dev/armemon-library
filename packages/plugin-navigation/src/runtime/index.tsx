/**
 * FILE: index.tsx
 * PATH: packages/plugin-navigation/src/runtime/index.tsx
 *
 * WHAT: Public runtime entry point — configureNavigationPlugin(config) returns a
 *       RuntimePluginObject whose provider is NavigationContainer (optionally with
 *       linking config).
 * WHY:  Unlike Redux/UI, the actual navigator *structure* (stack vs tabs vs drawer,
 *       which screens) isn't runtime-configurable data — it's generated app-specific
 *       code (RootNavigator.tsx, written directly by this plugin's wizard using the
 *       real @react-navigation/* packages). This plugin's own runtime surface is
 *       deliberately small: just the NavigationContainer wrapper every navigator
 *       structure needs regardless of type. RootNavigator renders as the `children`
 *       of KitProvider (see appEntryPatcher.ts), which places it *inside* this
 *       provider — so NavigationContainer ends up correctly wrapping the actual
 *       Stack/Tab/Drawer navigator tree.
 * HOW:  A thin factory closing over the given container props (linking, theme,
 *       onReady, onStateChange, ...) — every NavigationContainer prop except
 *       children, so app authors never have to drop the plugin to reach one.
 * WHEN: configureNavigationPlugin() runs once, at module-evaluation time, inside the
 *       app's generated navigation glue file.
 *
 * EXPORTS: configureNavigationPlugin, NavigationPluginConfig
 * DEPENDS ON: react, @react-navigation/native, @armemon-library/config-types
 * USED BY: generated armemon/navigation/index.ts (in scaffolded apps)
 */

import React, { type ReactElement, type ReactNode } from 'react';
import {
  NavigationContainer,
  type DocumentTitleOptions,
  type LinkingOptions,
  type NavigationAction,
  type NavigationState,
  type InitialState,
  type Theme,
} from '@react-navigation/native';
import type { RuntimePluginObject } from '@armemon-library/config-types';

/**
 * Everything NavigationContainer accepts, minus `children` (the plugin owns that:
 * your RootNavigator is rendered as the container's child).
 *
 * These used to be `linking` alone, which meant anything else — a theme, a screen
 * tracking hook, a web document title — required abandoning the plugin and hand-
 * writing the container. They are plain pass-throughs: React Navigation's own docs
 * for <NavigationContainer> describe each one exactly as it behaves here.
 */
export interface NavigationPluginConfig {
  /** Deep linking. Generated into navigation.config.ts when you enable it. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  linking?: LinkingOptions<any>;
  /** Colors React Navigation uses for headers, tab bars and card backgrounds. */
  theme?: Theme;
  /** Rendered until deep-link state resolves. Defaults to null (blank). */
  fallback?: ReactNode;
  /** Web only: how the browser tab title tracks the active route. */
  documentTitle?: DocumentTitleOptions;
  /** Restore a saved navigation state on launch (state persistence). */
  initialState?: InitialState;
  /** Fires once the container has finished mounting — the hide-splash hook. */
  onReady?: () => void;
  /** Fires on every navigation state change — the analytics/screen-tracking hook. */
  onStateChange?: (state: Readonly<NavigationState> | undefined) => void;
  /** Fires when an action isn't handled by any navigator. Useful in development. */
  onUnhandledAction?: (action: Readonly<NavigationAction>) => void;
}

export function configureNavigationPlugin(config: NavigationPluginConfig = {}): RuntimePluginObject {
  function BoundNavigationProvider({ children }: { children: ReactNode }): ReactElement {
    return (
      <NavigationContainer
        linking={config.linking}
        theme={config.theme}
        fallback={config.fallback}
        documentTitle={config.documentTitle}
        initialState={config.initialState}
        onReady={config.onReady}
        onStateChange={config.onStateChange}
        onUnhandledAction={config.onUnhandledAction}
      >
        {children}
      </NavigationContainer>
    );
  }

  return {
    name: 'navigation',
    provider: BoundNavigationProvider,
    index: 30,
    tasks: [],
  };
}
