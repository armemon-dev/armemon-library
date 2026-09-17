/**
 * FILE: OfflineBanner.tsx
 * PATH: packages/plugin-essentials/src/runtime/network/components/OfflineBanner.tsx
 *
 * WHAT: A thin red banner shown while the app is offline.
 * WHY:  Separated from provider.tsx so the visual presentation can be swapped
 *       without touching the connectivity-tracking logic.
 * HOW:  Plain RN View/Text, no interactivity.
 * WHEN: Rendered by NetworkProvider whenever offline and
 *       config.enabled && config.showOfflineBanner are both true.
 *
 * EXPORTS: OfflineBanner
 * DEPENDS ON: react, react-native
 * USED BY: packages/plugin-essentials/src/runtime/network/provider.tsx
 */

import React, { type ReactElement } from 'react';
import { View, Text, StyleSheet } from 'react-native';

export function OfflineBanner(): ReactElement {
  return (
    <View style={styles.banner}>
      <Text style={styles.text}>You&apos;re offline</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { backgroundColor: '#dc2626', paddingVertical: 6, alignItems: 'center' },
  text: { color: '#ffffff', fontSize: 12, fontWeight: '600' },
});
