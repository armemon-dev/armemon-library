/**
 * FILE: orchestrator.ts
 * PATH: packages/core/src/init/orchestrator.ts
 *
 * WHAT: Runs the full 3-phase init sequence — KIT_SETUP, then PLUGIN_INIT, then
 *       USER_TASKS — in strict order, each phase fully resolving before the next
 *       starts.
 * WHY:  This strict sequential-phase barrier is what makes cross-phase task
 *       dependencies implicit: a PLUGIN_INIT task can assume every KIT_SETUP task
 *       already ran, without declaring it via `dependsOn`.
 *
 *       Phases are now assigned from the UNION of plugin and user tasks rather than
 *       from where a task came from. Previously plugin tasks were filtered into
 *       KIT_SETUP/PLUGIN_INIT only and the user phase was built from user tasks
 *       alone — so a plugin task marked `phase: USER_TASKS` fell through all three
 *       filters and silently never ran, while `phase` on a user task was ignored
 *       entirely. `phase` is the only thing that decides placement now, whoever
 *       contributed the task.
 * HOW:  Builds both queues, buckets every task by phase, and awaits runPhase() three
 *       times. Progress is reported against the total across all three phases, so
 *       the splash screen's counter doesn't reset between them. An AbortSignal lets
 *       a caller stop the sequence at a phase boundary.
 * WHEN: Called once by KitProvider on mount.
 *
 * EXPORTS: orchestrate, OrchestrateOptions
 * DEPENDS ON: @armemon-library/config-types, ../tasks/queueBuilder, ./phaseRunner, ../context/TaskContext
 * USED BY: packages/core/src/provider/KitProvider.tsx
 */

import { TaskPhase, type RuntimePluginObject, type TaskFn, type TaskObject } from '@armemon-library/config-types';
import { buildPluginTasks, buildUserTasks, sortTaskQueue, type QueuedTask } from '../tasks/queueBuilder.js';
import { runPhase } from './phaseRunner.js';
import type { TaskProgressState } from '../context/TaskContext.js';

export interface OrchestrateOptions {
  plugins: RuntimePluginObject[];
  userTasks: Array<TaskFn | TaskObject>;
  onProgress: (state: TaskProgressState) => void;
  signal?: AbortSignal;
}

const PHASE_ORDER: TaskPhase[] = [TaskPhase.KIT_SETUP, TaskPhase.PLUGIN_INIT, TaskPhase.USER_TASKS];

export async function orchestrate(options: OrchestrateOptions): Promise<void> {
  const all: QueuedTask[] = [
    ...buildPluginTasks(options.plugins),
    ...buildUserTasks(options.userTasks),
  ];

  const phases = PHASE_ORDER.map((phase) =>
    sortTaskQueue(all.filter((task) => (task.phase ?? TaskPhase.PLUGIN_INIT) === phase)),
  );

  // One running total across all three phases, so progress reads 3/7 rather than
  // restarting at 0/2 each time a phase boundary is crossed.
  const grandTotal = phases.reduce(
    (sum, tasks) => sum + tasks.filter((task) => !task.background).length,
    0,
  );
  let completedSoFar = 0;

  for (const tasks of phases) {
    if (options.signal?.aborted) return;
    completedSoFar = await runPhase(tasks, options.onProgress, {
      grandTotal,
      completedBefore: completedSoFar,
      signal: options.signal,
    });
  }

  options.onProgress({
    currentTask: null,
    currentPlugin: null,
    totalTasks: grandTotal,
    completedTasks: completedSoFar,
  });
}
