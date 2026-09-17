/**
 * FILE: configLoader.ts
 * PATH: packages/core/src/config/configLoader.ts
 *
 * WHAT: A module-level singleton holding the app's generated runtime config
 *       (enabled plugins, user tasks, splash/error screen overrides), set via
 *       registerRuntimeConfig() and read by KitProvider via getRuntimeConfig().
 * WHY:  core is a published package with no knowledge of any given app's file
 *       layout, so it can't statically import an app-specific generated file. The
 *       generated armemon/runtime.generated.ts instead *pushes* its config into
 *       core by calling registerRuntimeConfig() before App.tsx renders <KitProvider>
 *       — this is what lets App.tsx stay a zero-prop, zero-manual-wiring render.
 * HOW:  Plain module-scoped variable; registerRuntimeConfig() sets it, getRuntimeConfig()
 *       throws a descriptive error if nothing has registered yet (a real integration
 *       bug, not a recoverable state).
 * WHEN: registerRuntimeConfig() runs at module-evaluation time (top of the generated
 *       runtime.generated.ts, imported before <KitProvider> renders); getRuntimeConfig()
 *       is read once by KitProvider on mount.
 *
 * EXPORTS: registerRuntimeConfig, getRuntimeConfig, tryGetRuntimeConfig, RuntimeConfig
 * DEPENDS ON: @armemon-library/config-types, react (ComponentType type only)
 * USED BY: generated armemon/runtime.generated.ts (in scaffolded apps), packages/core/src/provider/KitProvider.tsx
 */

import type { ComponentType } from 'react';
import type { RuntimePluginObject, TaskFn, TaskObject } from '@armemon-library/config-types';

export interface RuntimeConfig {
  plugins: RuntimePluginObject[];
  userTasks: Array<TaskFn | TaskObject>;
  SplashScreenComponent?: ComponentType;
  ErrorScreenComponent?: ComponentType<{ error: Error }>;
  readyCustom?: boolean;
  readyCustomTimeout?: number;
  /** Minimum time (ms) the splash stays up, even if tasks finish faster — avoids a flash on quick cold starts. */
  minSplashDurationMs?: number;
}

let registeredConfig: RuntimeConfig | null = null;

export function registerRuntimeConfig(config: RuntimeConfig): void {
  registeredConfig = config;
}

/**
 * The registered config, or null. Exists so KitProvider can read the configured
 * error screen BEFORE mounting the error boundary that will render it — reading
 * with getRuntimeConfig() there would throw the very error the boundary is meant
 * to catch, outside the boundary.
 */
export function tryGetRuntimeConfig(): RuntimeConfig | null {
  return registeredConfig;
}

export function getRuntimeConfig(): RuntimeConfig {
  if (!registeredConfig) {
    throw new Error(
      'No armemon runtime config registered, so <KitProvider> has nothing to start. In an app made by the armemon CLI, App.tsx must import "./armemon/runtime.generated" (or "./src/armemon/runtime.generated" in an older app) before anything else. Without the CLI, call registerRuntimeConfig({ plugins: [...], userTasks: [] }) in a file that App.tsx imports first.',
    );
  }
  return registeredConfig;
}
