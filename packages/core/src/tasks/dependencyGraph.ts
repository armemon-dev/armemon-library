/**
 * FILE: dependencyGraph.ts
 * PATH: packages/core/src/tasks/dependencyGraph.ts
 *
 * WHAT: Validates a task queue's `dependsOn` references (no missing ids, no cycles)
 *       and returns the tasks grouped into dependency LEVELS — tier 0 depends on
 *       nothing, tier N depends only on tiers below it.
 * WHY:  Tasks like "check auth" needing "load cache" first is a common init
 *       requirement; without this, authors would hand-order the whole queue and
 *       re-order it on every addition. Levels rather than a flat list because the
 *       phase runner needs to know which tasks are genuinely independent of each
 *       other in order to run parallel-marked ones together — a flat topological
 *       list loses exactly that information, and reconstructing it by filtering on a
 *       group key is what let a task run before its own dependency.
 *
 *       dependsOn is scoped to tasks within the same phase — phases are already
 *       sequential barriers — so a reference to a task in another phase is reported
 *       as such rather than as a generic "unknown id".
 * HOW:  Duplicate-id detection first (two tasks sharing an id makes every reference
 *       to it ambiguous), then Kahn's algorithm tier by tier, with (index, insertion)
 *       order as the tie-break inside a tier. A tier that comes back empty while
 *       tasks remain is a cycle, and the remaining names are named in the error.
 * WHEN: Called once per phase by the phase runner.
 *
 * EXPORTS: getExecutionLevels, getExecutionOrder
 * DEPENDS ON: @armemon-library/config-types
 * USED BY: packages/core/src/init/phaseRunner.ts
 */

import type { TaskObject } from '@armemon-library/config-types';

export function getExecutionLevels<T extends TaskObject>(tasks: T[]): T[][] {
  const byId = new Map<string, T>();
  for (const task of tasks) {
    if (!task.id) continue;
    if (byId.has(task.id)) {
      throw new Error(
        `Duplicate task id "${task.id}" (used by "${byId.get(task.id)?.name}" and "${task.name}") — ids must be unique within a phase.`,
      );
    }
    byId.set(task.id, task);
  }

  for (const task of tasks) {
    for (const depId of task.dependsOn ?? []) {
      if (!byId.has(depId)) {
        throw new Error(
          `Task "${task.name}" depends on task id "${depId}", which isn't in the same phase. dependsOn only resolves within one phase — phases already run in order, so a cross-phase dependency needs no declaration.`,
        );
      }
    }
  }

  const remaining = new Set(tasks);
  const done = new Set<T>();
  const levels: T[][] = [];

  const isReady = (task: T): boolean =>
    (task.dependsOn ?? []).every((depId) => {
      const dep = byId.get(depId);
      return dep !== undefined && done.has(dep);
    });

  while (remaining.size > 0) {
    const ready = [...remaining].filter(isReady).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

    if (ready.length === 0) {
      throw new Error(
        `Circular task dependency among: ${[...remaining].map((task) => task.name).join(', ')}.`,
      );
    }

    for (const task of ready) {
      done.add(task);
      remaining.delete(task);
    }
    levels.push(ready);
  }

  return levels;
}

/** Flattened form of getExecutionLevels, for callers that only want an order. */
export function getExecutionOrder<T extends TaskObject>(tasks: T[]): T[] {
  return getExecutionLevels(tasks).flat();
}
