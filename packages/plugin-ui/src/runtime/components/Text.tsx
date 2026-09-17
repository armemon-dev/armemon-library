/**
 * FILE: Text.tsx
 * PATH: packages/plugin-ui/src/runtime/components/Text.tsx
 *
 * WHAT: A themed drop-in replacement for RN's Text — resolves font size from the
 *       scaling context and color from the theme context.
 * WHY:  Gives scaffolded apps a working example of "how do I use the theme" beyond
 *       reading docs — most new screens start by reaching for Text/Button/Container.
 * HOW:  Reads useTheme()/useScaling(), merges resolved style with any style prop the
 *       caller passed (caller's style wins on conflicting keys, RN array-style
 *       merge order).
 * WHEN: Used directly by app screens once the UI plugin is enabled.
 *
 * EXPORTS: Text, ThemedTextProps
 * DEPENDS ON: react, react-native, ../context/ThemeContext, ../context/ScalingContext
 * USED BY: app screens (in scaffolded apps), generated ExampleScreen.tsx
 */

import React, { type ReactElement } from 'react';
import { Text as RNText, type TextProps } from 'react-native';
import { useTheme } from '../context/ThemeContext.js';
import { useScaling } from '../context/ScalingContext.js';
import type { FontSizeLevel } from '../theme.js';

export interface ThemedTextProps extends TextProps {
  level?: FontSizeLevel;
  muted?: boolean;
}

export function Text({ level = 'medium', muted = false, style, ...rest }: ThemedTextProps): ReactElement {
  const { colors } = useTheme();
  const { fontSize } = useScaling();

  return (
    <RNText
      style={[{ fontSize: fontSize(level), color: muted ? colors.textMuted : colors.text }, style]}
      {...rest}
    />
  );
}
