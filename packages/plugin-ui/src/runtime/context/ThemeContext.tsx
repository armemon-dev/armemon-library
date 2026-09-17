/**
 * FILE: ThemeContext.tsx
 * PATH: packages/plugin-ui/src/runtime/context/ThemeContext.tsx
 *
 * WHAT: React context resolving the active theme mode (light/dark, following the
 *       system when config is 'auto') and its color palette.
 * WHY:  Every themed component (Text, Button, Container) needs the resolved colors
 *       without each one re-deriving light/dark from the system scheme itself.
 * HOW:  Reads useColorScheme() only when config.themeMode is 'auto'; memoizes the
 *       resolved mode/colors so consumers don't re-render on unrelated state
 *       changes.
 * WHEN: Mounted once by configureUiPlugin()'s provider; read via useTheme() by any
 *       themed component or app screen.
 *
 * EXPORTS: ThemeProvider, useTheme, ThemeContextValue
 * DEPENDS ON: react, react-native, ../config, ../theme
 * USED BY: packages/plugin-ui/src/runtime/index.tsx, ../components/*
 */

import React, { createContext, useContext, useMemo, type ReactElement, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import type { UiConfig } from '../config.js';
import { resolveThemeColors, type ThemeColors } from '../theme.js';

export interface ThemeContextValue {
  mode: 'light' | 'dark';
  colors: ThemeColors;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export interface ThemeProviderProps {
  config: UiConfig;
  children: ReactNode;
}

export function ThemeProvider({ config, children }: ThemeProviderProps): ReactElement {
  const systemScheme = useColorScheme();

  const mode = useMemo<'light' | 'dark'>(() => {
    if (config.themeMode === 'auto') return systemScheme === 'dark' ? 'dark' : 'light';
    return config.themeMode;
  }, [config.themeMode, systemScheme]);

  const colors = useMemo(() => resolveThemeColors(mode, config.brandColor), [mode, config.brandColor]);
  const value = useMemo<ThemeContextValue>(() => ({ mode, colors }), [mode, colors]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme() must be used within the armemon UI plugin provider.');
  }
  return ctx;
}
