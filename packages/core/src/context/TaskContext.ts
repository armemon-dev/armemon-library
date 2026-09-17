/**
 * FILE: TaskContext.ts
 * PATH: packages/core/src/context/TaskContext.ts
 *
 * WHAT: React context carrying live init-task progress (current task name, the
 *       plugin that contributed it, total, completed count).
 * WHY:  Splash/loading screens need to show live progress without KitProvider having
 *       to know how any given screen wants to render it. `currentPlugin` is here so
 *       the provider can swap in a plugin's own `loadingComponent` while that
 *       plugin's tasks are running — that contract field was previously validated by
 *       core and then never rendered anywhere.
 * HOW:  Plain React.createContext with a zero-state default.
 * WHEN: Provided by KitProvider during the init phases; read via useTaskProgress().
 *
 * EXPORTS: TaskContext, TaskProgressState
 * DEPENDS ON: react
 * USED BY: packages/core/src/provider/KitProvider.tsx, packages/core/src/hooks/useTaskProgress.ts
 */

import { createContext } from 'react';

export interface TaskProgressState {
  currentTask: string | null;
  /** Name of the plugin whose task is running, or null for app-contributed tasks. */
  currentPlugin: string | null;
  totalTasks: number;
  completedTasks: number;
}

export const TaskContext = createContext<TaskProgressState>({
  currentTask: null,
  currentPlugin: null,
  totalTasks: 0,
  completedTasks: 0,
});
