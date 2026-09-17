/**
 * FILE: kitProvider.test.ts
 * PATH: packages/core/test/kitProvider.test.ts
 *
 * WHAT: <KitProvider> rendered for real — splash, init tasks, the provider chain, and
 *       the error screen.
 * WHY:  It is the one component every scaffolded app renders, and only its task
 *       engine was tested. The rest is where an app goes blank: children rendered
 *       before init finished, providers nested in the wrong order, a failed task that
 *       never reaches the error screen, or StrictMode running every init task twice.
 * HOW:  The built package in react-test-renderer, with a splash, an error screen and
 *       providers that label what they render, so the tree says what happened.
 */
import { createElement, StrictMode, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KitProvider, registerRuntimeConfig } from '../dist/index.mjs';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let renderer: ReactTestRenderer | undefined;

afterEach(() => {
  if (renderer) act(() => renderer!.unmount());
  renderer = undefined;
  vi.restoreAllMocks();
});

const text = () => JSON.stringify(renderer!.toJSON());
const settle = (ms = 20) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

function mount(children: ReactNode = 'the app', strict = false): void {
  const tree = createElement(KitProvider, null, children);
  act(() => {
    renderer = create(strict ? createElement(StrictMode, null, tree) : tree);
  });
}

/** A provider that wraps what it renders in its own label, so nesting shows in the output. */
const labelled = (name: string, index: number) => ({
  name,
  index,
  provider: ({ children }: { children: ReactNode }) => createElement('provider', { name }, children),
});

const Splash = () => createElement('splash', null, 'loading');
const ErrorScreen = ({ error }: { error: Error }) => createElement('error-screen', null, error.message);

// First, before anything registers a config: module state is shared within this file.
describe('KitProvider without a registered config', () => {
  it('shows the error screen with what to do, rather than a blank app', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mount();
    expect(text()).toContain('No armemon runtime config registered');
    expect(text()).not.toContain('the app');
  });
});

describe('KitProvider', () => {
  it('shows the splash until init finishes, then the app inside every provider, in index order', async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => (finish = resolve));
    registerRuntimeConfig({
      plugins: [labelled('inner', 20), labelled('outer', -10)],
      userTasks: [{ name: 'load', task: () => gate }],
      SplashScreenComponent: Splash,
      ErrorScreenComponent: ErrorScreen,
    });

    mount();
    await settle();
    expect(text()).toContain('loading');
    expect(text()).not.toContain('the app');

    await act(async () => finish());
    await settle();

    const tree = renderer!.toJSON() as { type: string; props: { name: string }; children: unknown[] };
    expect(tree.type).toBe('provider');
    expect(tree.props.name).toBe('outer');
    expect(JSON.stringify(tree.children)).toContain('"name":"inner"');
    expect(text()).toContain('the app');
  });

  it('shows the error screen when a critical task fails', async () => {
    registerRuntimeConfig({
      plugins: [],
      userTasks: [
        {
          name: 'broken',
          critical: true,
          task: () => {
            throw new Error('the API is down');
          },
        },
      ],
      SplashScreenComponent: Splash,
      ErrorScreenComponent: ErrorScreen,
    });

    mount();
    await settle(50);
    expect(text()).toContain('the API is down');
    expect(text()).not.toContain('the app');
  });

  // StrictMode mounts effects twice in development; init is once per process.
  it('runs each init task once under StrictMode', async () => {
    const task = vi.fn();
    registerRuntimeConfig({
      plugins: [],
      userTasks: [{ name: 'once', task }],
      SplashScreenComponent: Splash,
      ErrorScreenComponent: ErrorScreen,
    });

    mount('the app', true);
    await settle();
    expect(task).toHaveBeenCalledTimes(1);
    expect(text()).toContain('the app');
  });

  it('keeps the splash up for minSplashDurationMs even when init is instant', async () => {
    registerRuntimeConfig({
      plugins: [],
      userTasks: [],
      SplashScreenComponent: Splash,
      ErrorScreenComponent: ErrorScreen,
      minSplashDurationMs: 150,
    });

    mount();
    await settle(30);
    expect(text()).toContain('loading');

    await settle(200);
    expect(text()).toContain('the app');
  });
});
