/**
 * FILE: task.ts
 * PATH: packages/config-types/src/task.ts
 *
 * WHAT: Shared contract for the init-time task-orchestration engine — the shape every
 *       task (plugin-contributed or app-contributed) must conform to, plus the phases
 *       tasks run in.
 * WHY:  core's task engine and every plugin's `tasks` array need to agree on exactly
 *       one schema; defining it once here (rather than duplicating it in core and in
 *       each plugin) is what keeps the contract enforceable at compile time.
 * HOW:  Plain TypeScript types/enum, no runtime code — this package never ships logic,
 *       only types.
 * WHEN: Imported by core (to implement the engine) and by any plugin package that
 *       contributes init tasks via its `tasks` array.
 *
 * EXPORTS: TaskPhase, RetryStrategy, TaskFn, TaskExecutionContext, TaskObject
 * DEPENDS ON: nothing
 * USED BY: packages/core/src/tasks/*, packages/core/src/init/*, plugin runtime packages
 */

export enum TaskPhase {
  KIT_SETUP = 'KIT_SETUP',
  PLUGIN_INIT = 'PLUGIN_INIT',
  USER_TASKS = 'USER_TASKS',
}

export type RetryStrategy = 'linear' | 'exponential';

export interface TaskExecutionContext {
  signal: AbortSignal;
  abortable<T>(promise: Promise<T>): Promise<T>;
}

export type TaskFn = (ctx: TaskExecutionContext) => unknown | Promise<unknown>;

export interface TaskObject {
  name: string;
  task: TaskFn;
  phase?: TaskPhase;
  index?: number;
  timeout?: number;
  critical?: boolean;
  retries?: number;
  parallel?: boolean;
  runIf?: () => boolean | Promise<boolean>;
  background?: boolean;
  retryStrategy?: RetryStrategy;
  retryDelay?: number;
  maxRetryDelay?: number;
  group?: string;
  id?: string;
  dependsOn?: string[];
}
