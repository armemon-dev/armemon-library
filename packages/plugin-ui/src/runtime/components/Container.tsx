/**
 * FILE: Container.tsx
 * PATH: packages/plugin-ui/src/runtime/components/Container.tsx
 *
 * WHAT: A themed drop-in replacement for RN's View, filling available space with the
 *       theme's background color.
 * WHY:  Third of the "working theme example" set — most screens start with a root
 *       View that should match the theme background, not be left transparent/white
 *       by default.
 * HOW:  Wraps RN's View, merges the theme background color under any style prop the
 *       caller passed.
 * WHEN: Used directly by app screens once the UI plugin is enabled, typically as the
 *       root element of a screen.
 *
 * EXPORTS: Container
 * DEPENDS ON: react, react-native, ../context/ThemeContext
 * USED BY: app screens (in scaffolded apps), generated ExampleScreen.tsx
 */

import React, { type ReactElement } from 'react';
import { View, type ViewProps } from 'react-native';
import { useTheme } from '../context/ThemeContext.js';

export function Container({ style, ...rest }: ViewProps): ReactElement {
  const { colors } = useTheme();
  return <View style={[{ flex: 1, backgroundColor: colors.background }, style]} {...rest} />;
}
