/**
 * FILE: phaseRunner.ts
 * PATH: packages/core/src/init/phaseRunner.ts
 *
 * WHAT: Runs one phase's tasks to completion — resolving dependency order, firing
 *       background tasks without blocking, running parallel-marked tasks together
 *       within a dependency level, and reporting live progress.
 * WHY:  A phase is the unit of "must all finish (or be backgrounded) before the next
 *       phase starts"; dependency resolution, parallel grouping and progress
 *       reporting come together here.
 *
 *       Parallel execution is now organised by DEPENDENCY LEVEL. The previous
 *       implementation, on reaching the first task of a parallel group, pulled every
 *       member of that group out of the whole ordered list with a filter — including
 *       members that appeared later precisely because they depended on something
 *       that hadn't run yet, which discarded the topological order computed one
 *       function earlier and could run a task before its own dependency. It also
 *       meant `parallel: true` without an explicit `group` fell back to the task's
 *       own name, forming a group of one and running sequentially, so
 *       TaskPresets.parallel() did nothing on its own. Level-based batching fixes
 *       both: everything in a level is by definition dependency-free with respect to
 *       its siblings, so parallel tasks in the same level run together and an
 *       explicit `group` simply sub-divides a level.
 * HOW:  getExecutionLevels() returns dependency tiers. Within a tier, tasks marked
 *       parallel are batched (by `group` when given, otherwise the whole tier's
 *       parallel tasks) and awaited with Promise.all; everything else runs in order.
 * WHEN: Called once per TaskPhase by orchestrator.ts. Returns the running completed
 *       count so the orchestrator can keep one total across all three phases.
 *
 * EXPORTS: runPhase, RunPhaseOptions
 * DEPENDS ON: @armemon-library/config-types, ../tasks/dependencyGraph, ../tasks/executor, ../context/TaskContext
 * USED BY: packages/core/src/init/orchestrator.ts
 */

import { getExecutionLevels } from '../tasks/dependencyGraph.js';
import { executeTaskWithRetries } from '../tasks/executor.js';
import type { QueuedTask } from '../tasks/queueBuilder.js';
import type { TaskProgressState } from '../context/TaskContext.js';

export interface RunPhaseOptions {
  grandTotal: number;
  completedBefore: number;
  signal?: AbortSignal;
}

export async function runPhase(
  tasks: QueuedTask[],
  onProgress: (state: TaskProgressState) => void,
  options: RunPhaseOptions,
): Promise<number> {
  const levels = getExecutionLevels(tasks);
  let completed = options.completedBefore;

  const report = (task: QueuedTask | null): void => {
    onProgress({
      currentTask: task?.name ?? null,
      currentPlugin: task?.owner ?? null,
      totalTasks: options.grandTotal,
      completedTasks: completed,
    });
  };

  for (const level of levels) {
    if (options.signal?.aborted) return completed;

    // Background tasks never block the phase; a failure is logged, not thrown.
    for (const task of level.filter((candidate) => candidate.background)) {
      executeTaskWithRetries(task).catch((error: unknown) => {
        console.warn(`[armemon] background task "${task.name}" failed:`, error);
      });
    }

    const blocking = level.filter((task) => !task.background);
    const parallel = blocking.filter((task) => task.parallel);
    const sequential = blocking.filter((task) => !task.parallel);

    // Parallel tasks in this level, batched by `group` when one is given. An
    // ungrouped parallel task joins the level's default batch — which is what
    // "parallel" plainly means, and what TaskPresets.parallel() now actually does.
    const batches = new Map<string, QueuedTask[]>();
    for (const task of parallel) {
      const key = task.group ?? '__level__';
      const batch = batches.get(key) ?? [];
      batch.push(task);
      batches.set(key, batch);
    }

    for (const batch of batches.values()) {
      if (options.signal?.aborted) return completed;
      report(batch[0] ?? null);
      await Promise.all(batch.map((task) => executeTaskWithRetries(task)));
      completed += batch.length;
    }

    for (const task of sequential) {
      if (options.signal?.aborted) return completed;
      report(task);
      await executeTaskWithRetries(task);
      completed += 1;
    }
  }

  report(null);
  return completed;
}
