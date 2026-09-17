/**
 * FILE: theme.ts
 * PATH: packages/plugin-ui/src/runtime/theme.ts
 *
 * WHAT: Pure functions resolving a light/dark color palette and a type-scale font
 *       size, given the app's config.
 * WHY:  Kept separate from the React context wiring so the color/size math is
 *       trivially unit-testable without rendering anything.
 * HOW:  A small fixed light/dark palette pair; font sizes step geometrically by
 *       typeScaleRatio around the configured base (small = one step down, large/
 *       xlarge = one/two steps up), the standard type-scale convention.
 * WHEN: Called by ThemeProvider/ScalingProvider on every config or system-scheme
 *       change.
 *
 * EXPORTS: resolveThemeColors, resolveFontSize, ThemeColors, FontSizeLevel
 * DEPENDS ON: nothing
 * USED BY: packages/plugin-ui/src/runtime/context/ThemeContext.tsx, ./context/ScalingContext.tsx
 */

export interface ThemeColors {
  background: string;
  surface: string;
  text: string;
  textMuted: string;
  brand: string;
}

export type FontSizeLevel = 'small' | 'medium' | 'large' | 'xlarge';

export function resolveThemeColors(mode: 'light' | 'dark', brandColor: string): ThemeColors {
  if (mode === 'dark') {
    return {
      background: '#0f172a',
      surface: '#1e293b',
      text: '#f1f5f9',
      textMuted: '#94a3b8',
      brand: brandColor,
    };
  }

  return {
    background: '#ffffff',
    surface: '#f8fafc',
    text: '#0f172a',
    textMuted: '#64748b',
    brand: brandColor,
  };
}

const FONT_SIZE_STEPS: Record<FontSizeLevel, number> = {
  small: -1,
  medium: 0,
  large: 1,
  xlarge: 2,
};

export function resolveFontSize(base: number, ratio: number, level: FontSizeLevel): number {
  // A ratio of 0 makes the 'small' step (ratio ** -1) Infinity, and a base of 0
  // collapses every level to 0 — both reachable from the wizard's numeric prompts,
  // so they're clamped here rather than producing an unrenderable font size.
  const safeBase = Number.isFinite(base) && base > 0 ? base : 14;
  const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 1.2;
  return Math.max(1, Math.round(safeBase * safeRatio ** FONT_SIZE_STEPS[level]));
}
