/**
 * FILE: notifications.test.ts
 * PATH: packages/plugin-essentials/test/notifications.test.ts
 *
 * WHAT: The toast queue behind useNotifications(), rendered for real.
 * WHY:  Re-sending a toast under the same id — "Saving…" then "Saved" — replaced the
 *       queued entry but left the first toast's timer running, so the replacement was
 *       dismissed on the FIRST toast's schedule. One sent with delay 0, meant to stay
 *       up, disappeared too. Nothing tested the runtime, so nothing noticed.
 * HOW:  The built plugin's provider in react-test-renderer, fake timers, and a probe
 *       component holding the hook's latest value.
 */
import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureEssentialsPlugin, useNotifications } from '@armemon-library/essentials';

type Notifications = ReturnType<typeof useNotifications>;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let api: Notifications;
let renderer: ReactTestRenderer;

function Probe(): null {
  api = useNotifications();
  return null;
}

function mount(options: Parameters<typeof configureEssentialsPlugin>[0] = {}): void {
  const Provider = configureEssentialsPlugin(options).provider as (props: { children: ReactNode }) => ReactNode;
  act(() => {
    renderer = create(createElement(Provider, null, createElement(Probe)));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  mount();
});

afterEach(() => {
  act(() => renderer.unmount());
  vi.useRealTimers();
});

const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const messages = () => api.queue.map((item) => item.message);

describe('notifications', () => {
  it('dismisses a toast after its delay', () => {
    act(() => void api.notify({ message: 'Hello', delay: 1000 }));
    advance(999);
    expect(messages()).toEqual(['Hello']);
    advance(1);
    expect(messages()).toEqual([]);
  });

  it('gives a toast re-sent under the same id its own full delay', () => {
    act(() => void api.notify({ id: 'save', message: 'Saving…', delay: 1000 }));
    advance(600);
    act(() => void api.notify({ id: 'save', message: 'Saved', delay: 1000 }));

    // The first toast's timer would have fired here.
    advance(600);
    expect(messages()).toEqual(['Saved']);

    advance(400);
    expect(messages()).toEqual([]);
  });

  it('keeps a replacement sent with delay 0 until it is dismissed', () => {
    act(() => void api.notify({ id: 'upload', message: 'Uploading…', delay: 1000 }));
    act(() => void api.notify({ id: 'upload', message: 'Upload failed — tap to retry', delay: 0 }));

    advance(5000);
    expect(messages()).toEqual(['Upload failed — tap to retry']);

    act(() => api.dismiss('upload'));
    expect(messages()).toEqual([]);
  });

  it('shows one entry per id, never two with the same key', () => {
    act(() => void api.notify({ id: 'sync', message: 'one', delay: 0 }));
    act(() => void api.notify({ id: 'sync', message: 'two', delay: 0 }));
    expect(api.queue.map((item) => item.id)).toEqual(['sync']);
  });

  it('caps history at the configured limit, keeping the newest', () => {
    act(() => renderer.unmount());
    mount({ notifications: { historyLimit: 3 } });

    for (let index = 0; index < 5; index += 1) {
      act(() => void api.notify({ message: `n${index}`, delay: 0 }));
    }
    expect(api.history.map((item) => item.message)).toEqual(['n4', 'n3', 'n2']);
  });
});

describe('the toast stack', () => {
  // React Native deprecated the pointerEvents PROP in 0.73; the style form is the one
  // that stays. The gaps between toasts must still let taps through.
  it('lets taps through its gaps via style, not the deprecated prop', () => {
    act(() => void api.notify({ message: 'Saved', delay: 0 }));
    const stack = renderer.root.findAll(
      (node) => Array.isArray(node.props.style) && node.props.style.some((entry: { position?: string }) => entry?.position === 'absolute'),
    )[0]!;
    expect(stack.props.pointerEvents).toBeUndefined();
    expect(stack.props.style[0]).toMatchObject({ pointerEvents: 'box-none' });
  });
});
