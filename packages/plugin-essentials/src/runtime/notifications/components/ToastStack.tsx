/**
 * FILE: ToastStack.tsx
 * PATH: packages/plugin-essentials/src/runtime/notifications/components/ToastStack.tsx
 *
 * WHAT: Renders the currently-queued notifications as a stack of colored toasts,
 *       positioned top or bottom per config.
 * WHY:  Separated from provider.tsx so the visual presentation can be swapped or
 *       restyled without touching the queue/history state logic.
 * HOW:  Absolutely positioned stack; tapping a toast dismisses it early when
 *       swipeable is enabled.
 * WHEN: Rendered by NotificationsProvider whenever the queue is non-empty and
 *       config.enabled is true.
 *
 * EXPORTS: ToastStack
 * DEPENDS ON: react, react-native, ../provider (NotificationItem type)
 * USED BY: packages/plugin-essentials/src/runtime/notifications/provider.tsx
 */

import React, { type ReactElement } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import type { NotificationItem, NotificationType } from '../provider.js';

const TYPE_COLORS: Record<NotificationType, string> = {
  success: '#16a34a',
  error: '#dc2626',
  info: '#2563eb',
  warning: '#d97706',
};

export interface ToastStackProps {
  items: NotificationItem[];
  position: 'top' | 'bottom';
  swipeable: boolean;
  onDismiss: (id: string) => void;
}

export function ToastStack({ items, position, swipeable, onDismiss }: ToastStackProps): ReactElement | null {
  if (items.length === 0) return null;

  return (
    <View style={[styles.container, position === 'top' ? styles.top : styles.bottom]}>
      {items.map((item) => (
        <Pressable
          key={item.id}
          onPress={() => (swipeable ? onDismiss(item.id) : undefined)}
          style={[styles.toast, { backgroundColor: TYPE_COLORS[item.type] }]}
        >
          <Text style={styles.text}>{item.message}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // box-none: the gaps between toasts pass taps through to the screen underneath.
  // A style, not the pointerEvents prop, which React Native deprecated in 0.73 —
  // hence this package's react-native peer of >=0.71, where the style arrived.
  container: { position: 'absolute', left: 16, right: 16, gap: 8, pointerEvents: 'box-none' },
  top: { top: 48 },
  bottom: { bottom: 48 },
  toast: { padding: 12, borderRadius: 8 },
  text: { color: '#ffffff' },
});
