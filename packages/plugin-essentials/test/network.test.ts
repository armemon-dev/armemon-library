/**
 * FILE: network.test.ts
 * PATH: packages/plugin-essentials/test/network.test.ts
 *
 * WHAT: useNetworkStatus() and the offline banner, driven by a fake NetInfo adapter.
 * WHY:  The network provider decides whether a user is told they're offline, and it
 *       had no test. Its rules are easy to break and costly when broken: an unknown
 *       reachability counted as offline flashes the banner on every cold start, a
 *       poll that throws its result away never notices a change, and a subscription
 *       left behind keeps calling setState on an unmounted tree.
 * HOW:  The built plugin in react-test-renderer, with an adapter the test pushes
 *       snapshots through.
 */
import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  configureEssentialsPlugin,
  useNetworkStatus,
  type NetInfoAdapter,
  type NetInfoSnapshot,
} from '@armemon-library/essentials';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let status: ReturnType<typeof useNetworkStatus>;
let renderer: ReactTestRenderer | undefined;

function Probe(): null {
  status = useNetworkStatus();
  return null;
}

afterEach(() => {
  if (renderer) act(() => renderer!.unmount());
  renderer = undefined;
  vi.useRealTimers();
});

/** An adapter whose state the test sets, recording who is listening. */
function fakeAdapter(initial: NetInfoSnapshot) {
  let current = initial;
  const listeners = new Set<(state: NetInfoSnapshot) => void>();
  const adapter: NetInfoAdapter = {
    subscribe(listener) {
      listeners.add(listener);
      listener(current);
      return () => listeners.delete(listener);
    },
    fetch: vi.fn(async () => current),
  };
  return {
    adapter,
    listeners,
    /** Changes what the device reports, telling subscribers. */
    push(next: NetInfoSnapshot) {
      current = next;
      act(() => listeners.forEach((listener) => listener(next)));
    },
    /** Changes it without telling anyone — only a poll can find out. */
    changeQuietly(next: NetInfoSnapshot) {
      current = next;
    },
  };
}

function mount(options: Parameters<typeof configureEssentialsPlugin>[0]): void {
  const Provider = configureEssentialsPlugin(options).provider as (props: { children: ReactNode }) => ReactNode;
  act(() => {
    renderer = create(createElement(Provider, null, createElement(Probe)));
  });
}

const bannerShown = () => JSON.stringify(renderer!.toJSON()).toLowerCase().includes('offline');

describe('network status', () => {
  it('reports online, and shows no banner, when network checking is off', () => {
    mount({});
    expect(status).toMatchObject({ isOnline: true });
    expect(bannerShown()).toBe(false);
  });

  it('follows the adapter, and shows the banner while offline', () => {
    const device = fakeAdapter({ isConnected: true, isInternetReachable: true });
    mount({ netInfoAdapter: device.adapter, network: { showOfflineBanner: true, polling: false } });
    expect(status.isOnline).toBe(true);

    device.push({ isConnected: false, isInternetReachable: false });
    expect(status.isOnline).toBe(false);
    expect(bannerShown()).toBe(true);

    device.push({ isConnected: true, isInternetReachable: true });
    expect(status.isOnline).toBe(true);
    expect(bannerShown()).toBe(false);
  });

  // Reachability starts out unknown on every cold start. Counting that as offline
  // flashed the banner each time the app opened.
  it('treats reachability that is not known yet as online', () => {
    const device = fakeAdapter({ isConnected: true, isInternetReachable: null });
    mount({ netInfoAdapter: device.adapter, network: { mode: 'internet', showOfflineBanner: true, polling: false } });
    expect(status.isOnline).toBe(true);
    expect(bannerShown()).toBe(false);
  });

  it('in connection mode, counts a connection as online even without internet', () => {
    const device = fakeAdapter({ isConnected: true, isInternetReachable: false });
    mount({ netInfoAdapter: device.adapter, network: { mode: 'connection', polling: false } });
    expect(status.isOnline).toBe(true);
  });

  // fetch() doesn't reliably notify subscribers, so a poll has to use what it gets.
  it('applies what a poll finds, even when no event says so', async () => {
    vi.useFakeTimers();
    const device = fakeAdapter({ isConnected: true, isInternetReachable: true });
    mount({ netInfoAdapter: device.adapter, network: { polling: true, pollInterval: 1000 } });

    device.changeQuietly({ isConnected: false, isInternetReachable: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(status.isOnline).toBe(false);
  });

  it('stops listening and polling when it unmounts', async () => {
    vi.useFakeTimers();
    const device = fakeAdapter({ isConnected: true, isInternetReachable: true });
    mount({ netInfoAdapter: device.adapter, network: { polling: true, pollInterval: 1000 } });
    expect(device.listeners.size).toBe(1);

    act(() => renderer!.unmount());
    renderer = undefined;
    const polls = vi.mocked(device.adapter.fetch).mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);

    expect(device.listeners.size).toBe(0);
    expect(vi.mocked(device.adapter.fetch).mock.calls.length).toBe(polls);
  });
});
