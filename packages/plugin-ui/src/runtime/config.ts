/**
 * FILE: config.ts
 * PATH: packages/plugin-ui/src/runtime/config.ts
 *
 * WHAT: The UiConfig shape and its defaults.
 * WHY:  A single small, flat config object drives theme mode, type scale, and brand
 *       color — deliberately much smaller than the reference react-native-ui's
 *       config (which also covered per-type overrides, custom fonts, skins) since
 *       this v1 focuses on the common 80% case; those can layer on top later without
 *       a breaking change to this shape.
 * HOW:  Plain interface + a DEFAULT_UI_CONFIG object configureUiPlugin() merges
 *       partial app config against.
 * WHEN: Read once by configureUiPlugin() at module-evaluation time.
 *
 * EXPORTS: UiConfig, DEFAULT_UI_CONFIG
 * DEPENDS ON: nothing
 * USED BY: packages/plugin-ui/src/runtime/index.tsx, ./context/ThemeContext.tsx, ./context/ScalingContext.tsx
 */

export interface UiConfig {
  themeMode: 'light' | 'dark' | 'auto';
  baseFontSize: number;
  typeScaleRatio: number;
  textScaleMode: 'native' | 'custom' | 'both';
  brandColor: string;
}

export const DEFAULT_UI_CONFIG: UiConfig = {
  themeMode: 'auto',
  baseFontSize: 14,
  typeScaleRatio: 1.2,
  textScaleMode: 'both',
  brandColor: '#5eead4',
};
