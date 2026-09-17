/**
 * FILE: useTaskProgress.ts
 * PATH: packages/core/src/hooks/useTaskProgress.ts
 *
 * WHAT: Reads the current init-task progress state.
 * WHY:  Gives any splash/loading screen (default, builtin-splash, or a fully custom
 *       one supplied via config) a one-line way to show live task progress.
 * HOW:  Thin useContext(TaskContext) wrapper.
 * WHEN: Called from within any component rendered while KitProvider's init phases
 *       are still running.
 *
 * EXPORTS: useTaskProgress
 * DEPENDS ON: react, ../context/TaskContext
 * USED BY: packages/builtin-splash/src/runtime, any custom SplashScreen component
 */

import { useContext } from 'react';
import { TaskContext, type TaskProgressState } from '../context/TaskContext.js';

export function useTaskProgress(): TaskProgressState {
  return useContext(TaskContext);
}
