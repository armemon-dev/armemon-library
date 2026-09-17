/**
 * FILE: ErrorRenderer.tsx
 * PATH: packages/core/src/provider/ErrorRenderer.tsx
 *
 * WHAT: The default error screen shown when a critical init task fails and no custom
 *       ErrorScreenComponent is configured — shows the error message, nothing more.
 * WHY:  A critical task failure means the app genuinely can't start; showing nothing
 *       (a blank/frozen splash) is far worse for debugging than a plain error dump.
 * HOW:  Plain RN View/Text rendering error.message (and error.stack in __DEV__).
 * WHEN: Rendered by KitProvider when orchestrate() rejects and no custom
 *       ErrorScreenComponent was supplied.
 *
 * EXPORTS: DefaultErrorScreen
 * DEPENDS ON: react, react-native
 * USED BY: packages/core/src/provider/KitProvider.tsx
 */

import React, { type ReactElement } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';

export interface DefaultErrorScreenProps {
  error: Error;
}

export function DefaultErrorScreen({ error }: DefaultErrorScreenProps): ReactElement {
  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>App failed to start</Text>
        <Text style={styles.message}>{error.message}</Text>
        {__DEV__ && error.stack ? <Text style={styles.stack}>{error.stack}</Text> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff5f5',
  },
  content: {
    padding: 24,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#b91c1c',
    marginBottom: 8,
  },
  message: {
    fontSize: 14,
    color: '#7f1d1d',
    marginBottom: 12,
  },
  stack: {
    fontSize: 11,
    color: '#991b1b',
    fontFamily: 'Courier',
  },
});
