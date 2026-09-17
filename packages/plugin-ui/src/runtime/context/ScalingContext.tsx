/**
 * FILE: ScalingContext.tsx
 * PATH: packages/plugin-ui/src/runtime/context/ScalingContext.tsx
 *
 * WHAT: React context exposing a fontSize(level) function that blends the app's
 *       configured type scale with the OS accessibility text-size setting according
 *       to textScaleMode.
 * WHY:  'native' mode fully respects OS accessibility settings (best for
 *       accessibility compliance); 'custom' ignores it entirely (best for pixel-
 *       precise designs); 'both' blends the two — this is the tradeoff every RN app
 *       has to make somewhere, so it's made once here instead of ad hoc per screen.
 * HOW:  Reads PixelRatio.getFontScale() for the native multiplier and re-reads it
 *       whenever the app returns to the foreground, since the OS exposes no change
 *       event and the setting can only be changed from outside the app. 'both' mode
 *       averages the unscaled and natively-scaled values rather than picking an
 *       extreme.
 * WHEN: Mounted once by configureUiPlugin()'s provider; read via useScaling() by any
 *       themed component or app screen.
 *
 * EXPORTS: ScalingProvider, useScaling, ScalingContextValue
 * DEPENDS ON: react, react-native, ../config, ../theme
 * USED BY: packages/plugin-ui/src/runtime/index.tsx, ../components/*
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { AppState, PixelRatio } from 'react-native';
import type { UiConfig } from '../config.js';
import { resolveFontSize, type FontSizeLevel } from '../theme.js';

export interface ScalingContextValue {
  fontSize: (level?: FontSizeLevel) => number;
}

const ScalingContext = createContext<ScalingContextValue | null>(null);

export interface ScalingProviderProps {
  config: UiConfig;
  children: ReactNode;
}

export function ScalingProvider({ config, children }: ScalingProviderProps): ReactElement {
  const [nativeScale, setNativeScale] = useState(() => PixelRatio.getFontScale());

  // PixelRatio.getFontScale() is a one-shot read with no change event, so this used
  // to be captured once at first render and never updated — meaning a user who
  // changed their OS text size while the app was running saw no change until a full
  // restart, in the one provider whose stated purpose is accessibility-aware
  // scaling. Re-reading on foreground is the available signal: the OS setting can
  // only be changed by leaving the app.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      const next = PixelRatio.getFontScale();
      setNativeScale((current) => (current === next ? current : next));
    });
    return () => subscription.remove();
  }, []);

  const value = useMemo<ScalingContextValue>(
    () => ({
      fontSize: (level: FontSizeLevel = 'medium') => {
        const base = resolveFontSize(config.baseFontSize, config.typeScaleRatio, level);
        if (config.textScaleMode === 'custom') return base;
        if (config.textScaleMode === 'native') return base * nativeScale;
        return base * (0.5 + nativeScale / 2);
      },
    }),
    [config.baseFontSize, config.typeScaleRatio, config.textScaleMode, nativeScale],
  );

  return <ScalingContext.Provider value={value}>{children}</ScalingContext.Provider>;
}

export function useScaling(): ScalingContextValue {
  const ctx = useContext(ScalingContext);
  if (!ctx) {
    throw new Error('useScaling() must be used within the armemon UI plugin provider.');
  }
  return ctx;
}
