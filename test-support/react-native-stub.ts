/**
 * FILE: react-native-stub.ts
 * PATH: test-support/react-native-stub.ts
 *
 * WHAT: A minimal stand-in for `react-native` used by the Node test runner.
 * WHY:  The packages under test are built with `react-native` marked external, so
 *       importing a built bundle in Node tries to load the real package — which is
 *       Flow-typed source that Node cannot parse. Every runtime package re-exports
 *       its React surface from one entry, so even a pure task-engine test pulls the
 *       import in. Aliasing it to this stub lets the non-React logic be tested
 *       without a Metro/Jest environment.
 * HOW:  Host components are plain strings (React renders them as unknown intrinsics,
 *       which is fine for logic tests); the few APIs armemon actually calls return
 *       stable values.
 * WHEN: Wired in via vitest.config.ts's resolve.alias.
 */

export const View = 'View';
export const Text = 'Text';
export const ScrollView = 'ScrollView';
export const Pressable = 'Pressable';
export const TextInput = 'TextInput';
export const ActivityIndicator = 'ActivityIndicator';

export const StyleSheet = {
  create: <T>(styles: T): T => styles,
  absoluteFillObject: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
};

export const PixelRatio = {
  getFontScale: (): number => 1,
  get: (): number => 2,
};

export const AppState = {
  currentState: 'active' as const,
  addEventListener: () => ({ remove: () => {} }),
};

export const useColorScheme = (): 'light' | 'dark' | null => 'light';

export const AppRegistry = {
  registerComponent: () => {},
  runApplication: () => {},
};
