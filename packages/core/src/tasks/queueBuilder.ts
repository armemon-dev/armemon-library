/**
 * FILE: queueBuilder.ts
 * PATH: packages/core/src/tasks/queueBuilder.ts
 *
 * WHAT: Normalizes raw task input (bare functions or partial TaskObjects) into fully
 *       defaulted QueuedTasks, tagging each with the plugin that contributed it.
 * WHY:  Plugin authors and app developers shouldn't have to specify every field —
 *       most tasks are "just a function" — so defaulting happens once here and the
 *       executor can always assume a populated task. The `owner` tag exists so the
 *       provider can show a plugin's own loadingComponent while that plugin's tasks
 *       run: without it, `loadingComponent` was a contract field that core validated
 *       and then never rendered.
 * HOW:  Bare functions get default timeout/retry/phase values; an explicitly
 *       `undefined` field in a partial TaskObject is dropped before merging, so
 *       `{ phase: undefined }` inherits the default instead of erasing it. Plugin
 *       tasks are auto-indexed by (pluginIndex * 1000 + taskIndex) so cross-plugin
 *       ordering is stable without every author picking numbers.
 * WHEN: Called once by the orchestrator, before tasks are split by phase.
 *
 * EXPORTS: QueuedTask, normalizeTask, buildPluginTasks, buildUserTasks, sortTaskQueue
 * DEPENDS ON: @armemon-library/config-types
 * USED BY: packages/core/src/init/orchestrator.ts
 */

import { TaskPhase, type RuntimePluginObject, type TaskFn, type TaskObject } from '@armemon-library/config-types';

/** A fully-defaulted task, plus the name of the plugin that contributed it. */
export interface QueuedTask extends TaskObject {
  owner?: string;
}

const TASK_DEFAULTS = {
  timeout: 180000,
  critical: true,
  retries: 0,
  parallel: false,
  background: false,
  retryStrategy: 'linear' as const,
  retryDelay: 1000,
  maxRetryDelay: 30000,
};

/** Explicit `undefined` must not overwrite a default via object spread. */
function definedOnly<T extends object>(input: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out as Partial<T>;
}

export function normalizeTask(
  input: TaskFn | TaskObject,
  defaults: { phase: TaskPhase; owner?: string; fallbackName?: string },
): QueuedTask {
  if (typeof input === 'function') {
    return {
      ...TASK_DEFAULTS,
      name: input.name || defaults.fallbackName || 'anonymous-task',
      task: input,
      phase: defaults.phase,
      owner: defaults.owner,
    };
  }

  return {
    ...TASK_DEFAULTS,
    phase: defaults.phase,
    ...definedOnly(input),
    // Restated after the spread so the required fields survive definedOnly()'s
    // Partial<> return type, which TypeScript can't know preserves them.
    task: input.task,
    name: input.name || defaults.fallbackName || 'anonymous-task',
    owner: defaults.owner,
  };
}

export function buildPluginTasks(plugins: RuntimePluginObject[]): QueuedTask[] {
  const result: QueuedTask[] = [];

  plugins.forEach((plugin, pluginIndex) => {
    (plugin.tasks ?? []).forEach((task, taskIndex) => {
      const normalized = normalizeTask(task, {
        phase: TaskPhase.PLUGIN_INIT,
        owner: plugin.name,
        fallbackName: `${plugin.name}-task-${taskIndex + 1}`,
      });
      result.push({ ...normalized, index: normalized.index ?? pluginIndex * 1000 + taskIndex });
    });
  });

  return result;
}

export function buildUserTasks(tasks: Array<TaskFn | TaskObject>): QueuedTask[] {
  return tasks.map((task, taskIndex) => {
    const normalized = normalizeTask(task, {
      phase: TaskPhase.USER_TASKS,
      fallbackName: `user-task-${taskIndex + 1}`,
    });
    return { ...normalized, index: normalized.index ?? taskIndex };
  });
}

export function sortTaskQueue<T extends TaskObject>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}
