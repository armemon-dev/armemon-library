/**
 * FILE: index.ts
 * PATH: packages/config-types/src/index.ts
 *
 * WHAT: Public entry point for @armemon-library/config-types — re-exports every shared
 *       contract type.
 * WHY:  Gives every consumer a single import path (@armemon-library/config-types) instead of
 *       reaching into individual files.
 * HOW:  Barrel re-export.
 * WHEN: Imported wherever any armemon contract type is needed.
 *
 * EXPORTS: everything from ./task, ./plugin, ./wizard, ./appConfig, ./packageManager, ./platform
 * DEPENDS ON: ./task, ./plugin, ./wizard, ./appConfig, ./packageManager, ./platform
 * USED BY: every other package in this monorepo
 */

export * from './task.js';
export * from './plugin.js';
export * from './wizard.js';
export * from './appConfig.js';
export * from './packageManager.js';
export * from './platform.js';
export * from './language.js';
export * from './layout.js';
