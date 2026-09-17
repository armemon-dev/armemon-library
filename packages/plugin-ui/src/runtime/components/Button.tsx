/**
 * FILE: Button.tsx
 * PATH: packages/plugin-ui/src/runtime/components/Button.tsx
 *
 * WHAT: A themed pressable button — brand-colored background, white label text.
 * WHY:  Second half of the "working theme example" set alongside Text/Container.
 * HOW:  Wraps RN's Pressable, reads the brand color from useTheme(), renders its
 *       label via the themed Text component.
 * WHEN: Used directly by app screens once the UI plugin is enabled.
 *
 * EXPORTS: Button, ButtonProps
 * DEPENDS ON: react, react-native, ../context/ThemeContext, ./Text
 * USED BY: app screens (in scaffolded apps), generated ExampleScreen.tsx
 */

import React, { type ReactElement } from 'react';
import { Pressable, StyleSheet, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../context/ThemeContext.js';
import { Text } from './Text.js';

export interface ButtonProps extends Omit<PressableProps, 'style'> {
  label: string;
  style?: StyleProp<ViewStyle>;
}

export function Button({ label, style, ...rest }: ButtonProps): ReactElement {
  const { colors } = useTheme();

  return (
    <Pressable style={[styles.base, { backgroundColor: colors.brand }, style]} {...rest}>
      <Text level="medium" style={styles.label}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: 'center',
  },
  label: {
    color: '#ffffff',
    fontWeight: '600',
  },
});
