/**
 * FILE: SplashRenderer.tsx
 * PATH: packages/core/src/provider/SplashRenderer.tsx
 *
 * WHAT: The default splash/loading screen shown during init when no custom
 *       SplashScreenComponent is configured — a centered spinner plus live task name.
 * WHY:  Every scaffolded app needs *something* on screen during init even before the
 *       splash plugin/wizard has run (or if the user skips it) — this is the
 *       always-safe fallback.
 * HOW:  Plain RN View/ActivityIndicator/Text, reads live progress via
 *       useTaskProgress().
 * WHEN: Rendered by KitProvider whenever init hasn't finished and no custom
 *       SplashScreenComponent was supplied.
 *
 * EXPORTS: DefaultSplashScreen
 * DEPENDS ON: react, react-native, ../hooks/useTaskProgress
 * USED BY: packages/core/src/provider/KitProvider.tsx
 */

import React, { type ReactElement } from 'react';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';
import { useTaskProgress } from '../hooks/useTaskProgress.js';

export function DefaultSplashScreen(): ReactElement {
  const { currentTask, completedTasks, totalTasks } = useTaskProgress();

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" />
      {currentTask ? <Text style={styles.label}>{currentTask}</Text> : null}
      {totalTasks > 0 ? (
        <Text style={styles.count}>
          {completedTasks} / {totalTasks}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  label: {
    marginTop: 12,
    fontSize: 14,
    color: '#666666',
  },
  count: {
    marginTop: 4,
    fontSize: 12,
    color: '#999999',
    fontVariant: ['tabular-nums'],
  },
});
