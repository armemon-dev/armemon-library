/**
 * FILE: index.tsx
 * PATH: packages/plugin-ui/src/runtime/index.tsx
 *
 * WHAT: Public runtime entry point — configureUiPlugin(config) builds a
 *       RuntimePluginObject wiring ThemeProvider + ScalingProvider around children;
 *       also re-exports the theme/scaling hooks and starter components.
 * WHY:  Same factory pattern as plugin-redux: theme config genuinely differs per
 *       app, so this package exports a factory rather than a static plugin object.
 *       The app's generated armemon/ui/index.ts glue file calls this with its
 *       own theme.config.ts data and exports the result as UiPlugin (matching this
 *       package's manifest.runtimeExportName).
 * HOW:  Partial<UiConfig> is merged over DEFAULT_UI_CONFIG so a generated config only
 *       needs to specify what it wants to override.
 * WHEN: configureUiPlugin() runs once, at module-evaluation time, inside the app's
 *       generated UI glue file.
 *
 * EXPORTS: configureUiPlugin, useTheme, useScaling, Text, Button, Container, UiConfig
 * DEPENDS ON: react, @armemon-library/config-types, ./config, ./context/ThemeContext,
 *             ./context/ScalingContext
 * USED BY: generated armemon/ui/index.ts (in scaffolded apps)
 */

import React, { type ReactElement, type ReactNode } from 'react';
import type { RuntimePluginObject } from '@armemon-library/config-types';
import { DEFAULT_UI_CONFIG, type UiConfig } from './config.js';
import { ThemeProvider } from './context/ThemeContext.js';
import { ScalingProvider } from './context/ScalingContext.js';

export function configureUiPlugin(config: Partial<UiConfig> = {}): RuntimePluginObject {
  const merged: UiConfig = { ...DEFAULT_UI_CONFIG, ...config };

  function BoundUiProvider({ children }: { children: ReactNode }): ReactElement {
    return (
      <ThemeProvider config={merged}>
        <ScalingProvider config={merged}>{children}</ScalingProvider>
      </ThemeProvider>
    );
  }

  return {
    name: 'ui',
    provider: BoundUiProvider,
    index: 20,
    tasks: [],
  };
}

export { useTheme } from './context/ThemeContext.js';
export { useScaling } from './context/ScalingContext.js';
export { Text } from './components/Text.js';
export { Button } from './components/Button.js';
export { Container } from './components/Container.js';
export type { UiConfig } from './config.js';
// Exported so the pure type-scale maths can be tested against the built output.
export { resolveFontSize, resolveThemeColors } from './theme.js';
export type { ThemeColors, FontSizeLevel } from './theme.js';
