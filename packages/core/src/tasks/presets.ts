/**
 * FILE: presets.ts
 * PATH: packages/core/src/tasks/presets.ts
 *
 * WHAT: Small factory helpers for common TaskObject shapes (background, parallel,
 *       critical, conditional, network-flavored retry/backoff).
 * WHY:  Plugin authors write the same handful of task shapes repeatedly (e.g. "this
 *       network call should retry with backoff and not block the splash screen");
 *       these presets save re-typing the same field combinations everywhere.
 * HOW:  Each preset takes a base task shape and returns it merged with the relevant
 *       override fields.
 * WHEN: Used by plugin/built-in `tasks` arrays when authoring init tasks.
 *
 * EXPORTS: TaskPresets
 * DEPENDS ON: @armemon-library/config-types
 * USED BY: plugin runtime packages, builtin-* runtime packages
 */

import type { TaskObject } from '@armemon-library/config-types';

type TaskBase = Omit<TaskObject, 'background' | 'parallel' | 'critical' | 'runIf'>;

export const TaskPresets = {
  background: (task: TaskBase): TaskObject => ({ ...task, background: true }) as TaskObject,
  parallel: (task: TaskBase): TaskObject => ({ ...task, parallel: true }) as TaskObject,
  critical: (task: TaskBase): TaskObject => ({ ...task, critical: true }) as TaskObject,
  conditional: (task: TaskBase, runIf: () => boolean | Promise<boolean>): TaskObject =>
    ({ ...task, runIf }) as TaskObject,
  network: (task: TaskBase): TaskObject =>
    ({
      ...task,
      retries: 3,
      retryStrategy: 'exponential',
      timeout: 15000,
    }) as TaskObject,
};
