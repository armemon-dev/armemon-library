/**
 * FILE: plugin.ts
 * PATH: packages/config-types/src/plugin.ts
 *
 * WHAT: The two plugin contracts — the package.json discovery metadata (the "armemon"
 *       field, read by the CLI before install) and the runtime object shape every
 *       plugin's `.` export must satisfy (read by core inside the running app).
 * WHY:  These are the two seams the whole system is built around: CLI-time discovery
 *       (does this package look like an armemon plugin, what's its wizard entry point)
 *       and runtime registration (does this plugin object compose correctly into the
 *       provider chain). Keeping both contracts in one file makes "what do I need to
 *       implement" a single read for a plugin author. runtimeExportName/configExportName
 *       are explicit here rather than guessed from pluginId — the old reference CLI
 *       guessed export names via string-munging and that was a real source of silent
 *       codegen failures.
 * HOW:  Plain TypeScript interfaces, no runtime code.
 * WHEN: PluginManifest is read at CLI-time from an installed plugin's package.json;
 *       RuntimePluginObject is validated at app-runtime by core's registration.ts.
 *
 * EXPORTS: PluginManifest, RuntimePluginObject
 * DEPENDS ON: ./task (TaskFn, TaskObject), ./platform (Platform)
 * USED BY: packages/cli-kit/src/discovery/manifestReader.ts, packages/core/src/provider/plugins/registration.ts, every plugin package
 */

import type { ComponentType, ReactNode } from 'react';
import type { TaskFn, TaskObject } from './task.js';
import type { Platform } from './platform.js';

export interface PluginManifest {
  manifestVersion: 1;
  pluginId: string;
  displayName: string;
  description: string;
  category?: string;
  required?: boolean;
  runtimeExportName: string;
  configExportName?: string;
  peerPackages?: string[];
  /**
   * Platforms this plugin can actually work on. Omitted means "all". A plugin
   * listing only native platforms is hidden from the catalog when none of them
   * were selected — e.g. builtin-splash wraps react-native-bootsplash, which has
   * no web implementation at all, so offering it on a web-only app installs a
   * native module that throws on first call.
   */
  platforms?: Platform[];
  /**
   * pluginIds whose wizard MUST run before this one, because this plugin reads
   * their answers via ctx.alreadyAnsweredByOtherPlugins. Declared here and
   * topologically sorted by the CLI rather than relying on the order of a
   * hand-maintained array — that ordering was previously load-bearing and
   * enforced only by a comment.
   */
  dependsOn?: string[];
  compatibleWith?: {
    rnMin?: string;
  };
  /**
   * The plugin's settings object, which `armemon set <pluginId>.<option>` edits.
   *
   * `file` is inside the managed zone, written with its TypeScript extension — a
   * JavaScript app's .js twin is found on its own — and `exportName` is the object
   * it exports. Declaring it here is what makes a plugin settable, third-party ones
   * included; the CLI keeps no list of its own.
   */
  settings?: { file: string; exportName: string };
}

export interface RuntimePluginObject {
  name: string;
  provider: ComponentType<{ children: ReactNode }>;
  index?: number;
  tasks?: Array<TaskFn | TaskObject>;
  loadingComponent?: ComponentType;
}
