/**
 * FILE: LoadingOverlay.tsx
 * PATH: packages/plugin-essentials/src/runtime/loading/components/LoadingOverlay.tsx
 *
 * WHAT: A full-screen dimmed overlay showing either a spinner or an error message
 *       with a dismiss action.
 * WHY:  Separated from provider.tsx so presentation can change without touching the
 *       state logic. Two things this used to get wrong: it set
 *       `pointerEvents="none"`, so the "blocking" overlay let every tap through to
 *       the screen underneath — the opposite of what a scrim is for — and the
 *       provider's error state had no renderer at all, so showError() updated state
 *       nothing displayed, in a plugin whose own description promises "loading and
 *       error overlays".
 * HOW:  The overlay captures touches (default pointerEvents), which is what makes it
 *       block. The error variant is dismissible so an app can't be permanently
 *       wedged behind one, and it is announced to screen readers.
 * WHEN: Rendered by LoadingProvider whenever isLoading or error is set and the
 *       sub-feature is enabled.
 *
 * EXPORTS: LoadingOverlay
 * DEPENDS ON: react, react-native
 * USED BY: packages/plugin-essentials/src/runtime/loading/provider.tsx
 */

import React, { type ReactElement } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';

export interface LoadingOverlayProps {
  style: 'progressbar' | 'spinner' | 'blank';
  error?: Error | null;
  onDismissError?: () => void;
}

export function LoadingOverlay({ style, error, onDismissError }: LoadingOverlayProps): ReactElement {
  if (error) {
    return (
      <View
        style={styles.overlay}
        accessibilityRole="alert"
        accessibilityLiveRegion="assertive"
        accessible
      >
        <View style={styles.card}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>{error.message}</Text>
          {onDismissError ? (
            <Pressable
              style={styles.dismiss}
              onPress={onDismissError}
              accessibilityRole="button"
              accessibilityLabel="Dismiss error"
            >
              <Text style={styles.dismissText}>Dismiss</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.overlay} accessibilityRole="progressbar" accessibilityLabel="Loading">
      {style !== 'blank' ? <ActivityIndicator size="large" color="#ffffff" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 20,
    marginHorizontal: 32,
    maxWidth: 420,
    gap: 8,
  },
  title: { fontSize: 16, fontWeight: '700', color: '#7f1d1d' },
  message: { fontSize: 14, color: '#334155' },
  dismiss: {
    marginTop: 8,
    alignSelf: 'flex-end',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#dc2626',
  },
  dismissText: { color: '#ffffff', fontWeight: '600' },
});
