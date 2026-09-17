/**
 * FILE: index.ts
 * PATH: packages/core/src/index.ts
 *
 * WHAT: Public entry point for @armemon-library/core — re-exports KitProvider, the runtime
 *       config registration API, contexts/hooks, and task presets.
 * WHY:  Single import path for every scaffolded app and every plugin runtime module.
 * HOW:  Barrel re-export.
 * WHEN: Imported by generated App.tsx and runtime.generated.ts, and by every
 *       plugin's runtime module.
 *
 * EXPORTS: KitProvider, KitErrorBoundary, registerRuntimeConfig, getRuntimeConfig,
 *          RuntimeConfig, useTaskProgress, useKitReady, TaskPresets,
 *          DefaultSplashScreen, DefaultErrorScreen
 * DEPENDS ON: ./provider/KitProvider, ./config/configLoader, ./hooks/*, ./tasks/presets
 * USED BY: generated App.tsx / runtime.generated.ts, every plugin runtime package
 */

export { default as KitProvider } from './provider/KitProvider.js';
export {
  registerRuntimeConfig,
  getRuntimeConfig,
  tryGetRuntimeConfig,
  type RuntimeConfig,
} from './config/configLoader.js';
export { KitErrorBoundary } from './provider/ErrorBoundary.js';
export { DefaultSplashScreen } from './provider/SplashRenderer.js';
export { DefaultErrorScreen } from './provider/ErrorRenderer.js';
export { useTaskProgress } from './hooks/useTaskProgress.js';
export { useKitReady } from './hooks/useKitReady.js';
export { TaskPresets } from './tasks/presets.js';
// Internals, exported so the regression suite can exercise them against the built
// output rather than reaching into src.
export { orchestrate } from './init/orchestrator.js';
export { executeTaskWithRetries, TaskTimeoutError } from './tasks/executor.js';
export { getExecutionLevels, getExecutionOrder } from './tasks/dependencyGraph.js';
export {
  normalizeTask,
  buildPluginTasks,
  buildUserTasks,
  sortTaskQueue,
  type QueuedTask,
} from './tasks/queueBuilder.js';
export { registerPlugins, validatePlugin } from './provider/plugins/registration.js';
export { ProviderChain } from './provider/ProviderChain.js';
export type { TaskProgressState } from './context/TaskContext.js';
export type { KitReadyState } from './context/KitReadyContext.js';
