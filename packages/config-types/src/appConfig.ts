/**
 * FILE: appConfig.ts
 * PATH: packages/config-types/src/appConfig.ts
 *
 * WHAT: The shape of a scaffolded app's armemon.config.ts — the on-disk record of
 *       which platforms/package manager/plugins were chosen and what each plugin's
 *       wizard answers were.
 * WHY:  This file is both the CLI's re-generation source of truth (for a future
 *       `armemon add`/`armemon remove`) and a human-readable record of what choices
 *       were made when the app was scaffolded.
 * HOW:  Plain TypeScript interface, no runtime code.
 * WHEN: Written by the CLI during `armemon init`, read back by `armemon add`/`remove`
 *       and by any future `armemon doctor` sanity checker.
 *
 * EXPORTS: ArmemonAppConfig
 * DEPENDS ON: ./platform, ./packageManager
 * USED BY: packages/cli-kit/src/fs/configFile.ts, packages/cli-armemon/src/flows/initReactNative.ts
 */

import type { Platform } from './platform.js';
import type { PackageManager } from './packageManager.js';
import type { AppLanguage } from './language.js';

export interface ArmemonAppConfig {
  appName: string;
  rnVersion: string;
  platforms: Platform[];
  packageManager: PackageManager;
  language: AppLanguage;
  plugins: Record<string, Record<string, unknown>>;
}
