/**
 * Regression tests for the init-task engine. Every case here corresponds to a
 * defect that shipped: a timeout that never fired, an abortable that could hang,
 * a runIf that escaped the retry loop, a parallel batch that ran before its own
 * dependency, and a phase filter that silently dropped tasks.
 *
 * Imports the built output rather than src, so what's tested is what ships.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  getExecutionLevels,
  getExecutionOrder,
} from '../dist/index.mjs';
import { executeTaskWithRetries } from '../dist/index.mjs';
import { normalizeTask, buildPluginTasks, buildUserTasks } from '../dist/index.mjs';
import { orchestrate } from '../dist/index.mjs';
import { registerPlugins, validatePlugin } from '../dist/index.mjs';
import { TaskPhase } from '@armemon-library/config-types';

const noop = async () => {};

describe('getExecutionLevels', () => {
  it('groups independent tasks into one level and dependents into the next', () => {
    const a = { name: 'a', id: 'a', task: noop };
    const b = { name: 'b', id: 'b', task: noop };
    const c = { name: 'c', id: 'c', task: noop, dependsOn: ['a', 'b'] };

    const levels = getExecutionLevels([c, a, b]);
    expect(levels).toHaveLength(2);
    expect(levels[0]!.map((t) => t.name).sort()).toEqual(['a', 'b']);
    expect(levels[1]!.map((t) => t.name)).toEqual(['c']);
  });

  it('rejects duplicate ids, which make every reference to them ambiguous', () => {
    const tasks = [
      { name: 'first', id: 'dup', task: noop },
      { name: 'second', id: 'dup', task: noop },
    ];
    expect(() => getExecutionLevels(tasks)).toThrow(/Duplicate task id "dup"/);
  });

  it('names the cross-phase limitation instead of saying "unknown id"', () => {
    const tasks = [{ name: 'a', task: noop, dependsOn: ['elsewhere'] }];
    expect(() => getExecutionLevels(tasks)).toThrow(/only resolves within one phase/);
  });

  it('detects cycles and names the tasks involved', () => {
    const tasks = [
      { name: 'a', id: 'a', task: noop, dependsOn: ['b'] },
      { name: 'b', id: 'b', task: noop, dependsOn: ['a'] },
    ];
    expect(() => getExecutionLevels(tasks)).toThrow(/Circular task dependency among: a, b/);
  });

  it('breaks ties within a level by index', () => {
    const order = getExecutionOrder([
      { name: 'late', task: noop, index: 10 },
      { name: 'early', task: noop, index: -5 },
    ]);
    expect(order.map((t) => t.name)).toEqual(['early', 'late']);
  });
});

describe('executeTaskWithRetries', () => {
  it('enforces the timeout even when the task never checks ctx.signal', async () => {
    // The original implementation aborted a signal but never raced the task
    // against it, so a task like this hung the splash screen forever.
    const task = {
      name: 'hangs',
      timeout: 40,
      task: () => new Promise(() => {}),
    };
    await expect(executeTaskWithRetries(task)).rejects.toThrow(/timed out after 40ms/);
  });

  it('rejects immediately when abortable() is called after the deadline passed', async () => {
    // addEventListener('abort') never fires on an already-aborted signal, so this
    // used to race against a promise that could never settle.
    const task = {
      name: 'late-abortable',
      timeout: 20,
      critical: false,
      task: async (ctx: { abortable<T>(p: Promise<T>): Promise<T> }) => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        await ctx.abortable(new Promise(() => {}));
      },
    };
    // critical:false swallows it, but it must RESOLVE rather than hang.
    await expect(executeTaskWithRetries(task)).resolves.toBeUndefined();
  });

  it('retries a throwing runIf and honours critical:false instead of escaping', async () => {
    const runIf = vi.fn(() => {
      throw new Error('predicate exploded');
    });
    const inner = vi.fn(noop);
    await expect(
      executeTaskWithRetries({
        name: 'bad-predicate',
        task: inner,
        runIf,
        retries: 1,
        retryDelay: 1,
        critical: false,
      }),
    ).resolves.toBeUndefined();
    expect(runIf).toHaveBeenCalledTimes(2);
    expect(inner).not.toHaveBeenCalled();
  });

  it('skips the task when runIf returns false', async () => {
    const inner = vi.fn(noop);
    await executeTaskWithRetries({ name: 'skipped', task: inner, runIf: () => false });
    expect(inner).not.toHaveBeenCalled();
  });

  it('retries up to `retries` extra times, then throws for a critical task', async () => {
    const inner = vi.fn(async () => {
      throw new Error('nope');
    });
    await expect(
      executeTaskWithRetries({ name: 'flaky', task: inner, retries: 2, retryDelay: 1 }),
    ).rejects.toThrow('nope');
    expect(inner).toHaveBeenCalledTimes(3);
  });

  it('succeeds on a later attempt without throwing', async () => {
    let calls = 0;
    const inner = async () => {
      calls += 1;
      if (calls < 3) throw new Error('not yet');
    };
    await expect(
      executeTaskWithRetries({ name: 'eventual', task: inner, retries: 3, retryDelay: 1 }),
    ).resolves.toBeUndefined();
    expect(calls).toBe(3);
  });
});

describe('normalizeTask', () => {
  it('does not let an explicit undefined erase a default', () => {
    const task = normalizeTask(
      { name: 'x', task: noop, phase: undefined, critical: undefined },
      { phase: TaskPhase.KIT_SETUP },
    );
    expect(task.phase).toBe(TaskPhase.KIT_SETUP);
    expect(task.critical).toBe(true);
  });

  it('gives anonymous functions distinct fallback names', () => {
    const tasks = buildUserTasks([async () => {}, async () => {}]);
    expect(new Set(tasks.map((t) => t.name)).size).toBe(2);
  });

  it('tags plugin tasks with their owner so loadingComponent can be resolved', () => {
    const tasks = buildPluginTasks([
      { name: 'redux', provider: () => null, tasks: [async () => {}] },
    ] as never);
    expect(tasks[0]!.owner).toBe('redux');
  });
});

describe('orchestrate', () => {
  it('runs a plugin task phased USER_TASKS instead of silently dropping it', async () => {
    const ran: string[] = [];
    await orchestrate({
      plugins: [
        {
          name: 'p',
          provider: () => null,
          tasks: [
            { name: 'late', phase: TaskPhase.USER_TASKS, task: async () => void ran.push('late') },
            { name: 'setup', phase: TaskPhase.KIT_SETUP, task: async () => void ran.push('setup') },
          ],
        },
      ] as never,
      userTasks: [],
      onProgress: () => {},
    });
    expect(ran).toEqual(['setup', 'late']);
  });

  it('honours `phase` on a user task rather than ignoring it', async () => {
    const ran: string[] = [];
    await orchestrate({
      plugins: [
        {
          name: 'p',
          provider: () => null,
          tasks: [{ name: 'plugin-init', task: async () => void ran.push('plugin-init') }],
        },
      ] as never,
      userTasks: [
        { name: 'user-first', phase: TaskPhase.KIT_SETUP, task: async () => void ran.push('user-first') },
      ],
      onProgress: () => {},
    });
    expect(ran).toEqual(['user-first', 'plugin-init']);
  });

  it('never runs a parallel task before its own dependency', async () => {
    const ran: string[] = [];
    await orchestrate({
      plugins: [
        {
          name: 'p',
          provider: () => null,
          tasks: [
            { name: 'A', id: 'A', parallel: true, task: async () => void ran.push('A') },
            {
              name: 'B',
              id: 'B',
              parallel: true,
              dependsOn: ['A'],
              task: async () => void ran.push('B'),
            },
          ],
        },
      ] as never,
      userTasks: [],
      onProgress: () => {},
    });
    expect(ran).toEqual(['A', 'B']);
  });

  it('runs ungrouped parallel tasks in the same level concurrently', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const makeTask = (name: string) => ({
      name,
      parallel: true,
      task: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 10));
        inFlight -= 1;
      },
    });

    await orchestrate({
      plugins: [
        { name: 'p', provider: () => null, tasks: [makeTask('a'), makeTask('b'), makeTask('c')] },
      ] as never,
      userTasks: [],
      onProgress: () => {},
    });
    expect(maxInFlight).toBe(3);
  });

  it('reports one running total across all three phases', async () => {
    const totals: number[] = [];
    await orchestrate({
      plugins: [
        {
          name: 'p',
          provider: () => null,
          tasks: [
            { name: 'a', phase: TaskPhase.KIT_SETUP, task: noop },
            { name: 'b', phase: TaskPhase.PLUGIN_INIT, task: noop },
          ],
        },
      ] as never,
      userTasks: [async () => {}],
      onProgress: (state) => totals.push(state.totalTasks),
    });
    expect(new Set(totals)).toEqual(new Set([3]));
  });

  it('does not block the phase on a background task', async () => {
    const ran: string[] = [];
    await orchestrate({
      plugins: [
        {
          name: 'p',
          provider: () => null,
          tasks: [
            {
              name: 'slow-bg',
              background: true,
              task: async () => {
                await new Promise((resolve) => setTimeout(resolve, 200));
                ran.push('bg');
              },
            },
            { name: 'fast', task: async () => void ran.push('fast') },
          ],
        },
      ] as never,
      userTasks: [],
      onProgress: () => {},
    });
    expect(ran).toEqual(['fast']);
  });
});

describe('registerPlugins', () => {
  it('sorts by index ascending so the smallest index ends up outermost', () => {
    const sorted = registerPlugins([
      { name: 'nav', provider: () => null, index: 30 },
      { name: 'splash', provider: () => null, index: -100 },
      { name: 'redux', provider: () => null, index: 10 },
    ] as never);
    expect(sorted.map((p) => p.name)).toEqual(['splash', 'redux', 'nav']);
  });

  it('rejects duplicate plugin names', () => {
    expect(() =>
      registerPlugins([
        { name: 'dup', provider: () => null },
        { name: 'dup', provider: () => null },
      ] as never),
    ).toThrow(/Duplicate armemon plugin name/);
  });

  it('accepts a memo/forwardRef provider, which is an object not a function', () => {
    const memoish = { $$typeof: Symbol.for('react.memo'), type: () => null };
    expect(() => validatePlugin({ name: 'memoed', provider: memoish } as never)).not.toThrow();
  });

  it('still rejects a missing provider', () => {
    expect(() => validatePlugin({ name: 'broken' } as never)).toThrow(/missing a valid "provider"/);
  });
});
