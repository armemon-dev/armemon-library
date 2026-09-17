/**
 * FILE: runtime.test.ts
 * PATH: packages/plugin-redux/test/runtime.test.ts
 *
 * WHAT: Guards the store handle configureReduxPlugin() hands back.
 * WHY:  The generated glue file documents ReduxPlugin.store and .persistor as the
 *       way to reach state from outside React — an API client reading the token, an
 *       init task hydrating before render, a push handler dispatching from no
 *       component at all. Documentation that names an API is a promise; without a
 *       test, the next refactor of the returned object breaks every app that took
 *       the promise up, and nothing here would notice.
 * HOW:  Builds a store from a plain slice config and dispatches into it with no
 *       React tree anywhere.
 */
import { describe, expect, it } from 'vitest';

// react-native's __DEV__ global doesn't exist under node, and the plugin reads it
// while resolving devTools.
(globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;

const load = async () =>
  (await import('../dist/runtime/index.mjs')) as unknown as {
    configureReduxPlugin: (config: unknown) => {
      name: string;
      provider: unknown;
      store: { getState: () => Record<string, { v: number }>; dispatch: (a: unknown) => void };
      persistor: unknown;
    };
  };

const counter = {
  slices: {
    counter: {
      name: 'counter',
      initialState: { v: 0 },
      reducers: { inc: (state: { v: number }) => { state.v += 1; } },
    },
  },
};

describe('configureReduxPlugin', () => {
  it('still returns a usable plugin object', async () => {
    const { configureReduxPlugin } = await load();
    const plugin = configureReduxPlugin(counter);
    expect(plugin.name).toBe('redux');
    expect(plugin.provider).toBeTypeOf('function');
  });

  it('exposes the store it built, so state is reachable outside React', async () => {
    const { configureReduxPlugin } = await load();
    const plugin = configureReduxPlugin(counter);

    expect(plugin.store.getState().counter.v).toBe(0);
    plugin.store.dispatch({ type: 'counter/inc' });
    expect(plugin.store.getState().counter.v).toBe(1);
  });

  it('exposes a persistor key even with persistence off', async () => {
    // The glue file documents ReduxPlugin.persistor unconditionally, so the key has
    // to exist either way — undefined is fine, missing is a TypeError at the call.
    const { configureReduxPlugin } = await load();
    expect('persistor' in configureReduxPlugin(counter)).toBe(true);
  });
});
