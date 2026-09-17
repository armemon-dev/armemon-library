/**
 * FILE: config.test.ts
 * PATH: packages/plugin-essentials/test/config.test.ts
 *
 * WHAT: How Essentials options become a full config — above all, when the network
 *       check is on.
 * WHY:  The check needs @react-native-community/netinfo, an optional package. It used
 *       to default to on, so `configureEssentialsPlugin()` with no arguments threw at
 *       startup in any app without NetInfo installed — the first line anyone using the
 *       package on its own writes. These pin the replacement rule, and pin that an app
 *       made by the CLI (which always sets `enabled` explicitly) behaves as before.
 * HOW:  Against the source module: the runtime entry imports React Native, which cannot
 *       be loaded in Node, and this module deliberately imports nothing that does.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_ESSENTIALS_CONFIG, resolveEssentialsConfig } from '../src/runtime/config';

/** Only its presence matters to the rule under test. */
const adapter = {} as never;

describe('resolveEssentialsConfig', () => {
  it('works with no options, and leaves the network check off', () => {
    expect(() => resolveEssentialsConfig()).not.toThrow();
    expect(resolveEssentialsConfig().network.enabled).toBe(false);
  });

  it('turns the network check on when an adapter is given', () => {
    expect(resolveEssentialsConfig({ netInfoAdapter: adapter }).network.enabled).toBe(true);
  });

  /** An explicit request armemon can't honour is an error, not something to quietly skip. */
  it('still refuses an explicit request for the check without an adapter', () => {
    expect(() => resolveEssentialsConfig({ network: { enabled: true } })).toThrow(
      /no NetInfo adapter was provided/,
    );
  });

  it('lets an explicit off win even when an adapter is given', () => {
    expect(
      resolveEssentialsConfig({ network: { enabled: false }, netInfoAdapter: adapter }).network.enabled,
    ).toBe(false);
  });

  it('merges each group field by field, keeping the defaults it was not given', () => {
    const resolved = resolveEssentialsConfig({ notifications: { position: 'bottom' } });

    expect(resolved.notifications.position).toBe('bottom');
    expect(resolved.notifications.defaultDelay).toBe(DEFAULT_ESSENTIALS_CONFIG.notifications.defaultDelay);
  });

  /** The shape the CLI generates: every section spelled out, network on, adapter passed. */
  it('behaves exactly as before for an app made by the CLI', () => {
    const generated = {
      notifications: { ...DEFAULT_ESSENTIALS_CONFIG.notifications },
      network: { ...DEFAULT_ESSENTIALS_CONFIG.network, enabled: true },
      loading: { ...DEFAULT_ESSENTIALS_CONFIG.loading },
    };

    const resolved = resolveEssentialsConfig({ ...generated, netInfoAdapter: adapter });
    expect(resolved).toEqual(generated);
  });
});
