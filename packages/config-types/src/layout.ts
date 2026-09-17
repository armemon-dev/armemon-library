/**
 * FILE: layout.ts
 * PATH: packages/config-types/src/layout.ts
 *
 * WHAT: Where armemon's managed files live, where the app author's own code lives, and
 *       how a file in one zone imports a file in the other.
 * WHY:  Two zones, one rule each. `armemon/` at the app root is armemon's: commands
 *       write and re-edit the store, the navigator, the linking config and each
 *       plugin's config, and every one of those edits has to still work on the next
 *       command. `src/` is the author's: screens, slices, shared components — armemon
 *       creates files there and then leaves them alone.
 *
 *       The split only holds if it has one definition. Thirty generators each spelling
 *       'src/armemon/navigation/RootNavigator.tsx' is how a layout drifts, and how a
 *       move like this one becomes impossible. It lives in config-types rather than
 *       cli-kit because every plugin wizard needs it and none of them should take a
 *       dependency on the CLI toolkit to say where a file goes.
 * HOW:  Constants and posix path maths, no I/O — cli-kit's readLayout() is what asks
 *       the disk. Apps scaffolded before the move keep their managed files in
 *       `src/armemon/`: that layout is still read and edited in place, and
 *       `armemon sync` is what moves one up.
 * WHEN: Imported by every wizard's generate step, by the screen commands, and by init.
 *
 * EXPORTS: MANAGED_DIR, LEGACY_MANAGED_DIR, WORKSPACE_DIR, SCREENS_DIR, SHARED_DIR,
 *          SLICES_DIR, EXAMPLES_DIR, AppLayout, DEFAULT_LAYOUT, LEGACY_LAYOUT,
 *          layoutOf, managedPath, workspacePath, isManaged, specifierFor, managedFile
 * DEPENDS ON: nothing
 * USED BY: every plugin's src/wizard/generate.ts, packages/cli-kit/src/fs/layout.ts
 */

import type { AppLanguage } from './language.js';

/** armemon's zone, at the app root so it reads as a sibling of src/, not a part of it. */
export const MANAGED_DIR = 'armemon';
/** Where it used to be. Still read; `armemon sync` moves it. */
export const LEGACY_MANAGED_DIR = 'src/armemon';

/** The author's zone. */
export const WORKSPACE_DIR = 'src';
export const SCREENS_DIR = 'src/screens';
export const SHARED_DIR = 'src/shared';
export const SLICES_DIR = 'src/store/slices';
/** armemon's stock parts, written once for reading and deleting. */
export const EXAMPLES_DIR = 'src/armemon-examples';

export interface AppLayout {
  /** App-relative, forward slashes: 'armemon', or 'src/armemon' in an older app. */
  managed: string;
  /** True when the app still keeps its managed files under src/. */
  legacy: boolean;
}

export const DEFAULT_LAYOUT: AppLayout = { managed: MANAGED_DIR, legacy: false };
export const LEGACY_LAYOUT: AppLayout = { managed: LEGACY_MANAGED_DIR, legacy: true };

/** The layout a wizard was handed, or the current one. */
export function layoutOf(context: { layout?: AppLayout }): AppLayout {
  return context.layout ?? DEFAULT_LAYOUT;
}

/** An app-relative path in the managed zone: managedPath(layout, 'navigation', 'types.ts'). */
export function managedPath(layout: AppLayout, ...segments: string[]): string {
  return [layout.managed, ...segments].join('/');
}

/** An app-relative path in the author's zone. */
export function workspacePath(...segments: string[]): string {
  return segments.join('/');
}

/** Whether an app-relative path belongs to armemon rather than to the author. */
export function isManaged(layout: AppLayout, appRelativePath: string): boolean {
  const normalized = appRelativePath.replace(/\\/g, '/');
  return normalized === layout.managed || normalized.startsWith(`${layout.managed}/`);
}

/**
 * The import specifier one app-relative file uses to reach another — the thing that
 * changes for every generated cross-zone import when the managed zone moves.
 */
export function specifierFor(fromFile: string, toFile: string): string {
  const from = fromFile.replace(/\\/g, '/').split('/').slice(0, -1);
  const to = toFile.replace(/\\/g, '/').replace(/\.[jt]sx?$/, '').replace(/\/index$/, '').split('/');

  let shared = 0;
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) shared += 1;
  const up = from.length - shared;
  const steps = [...(up > 0 ? Array.from({ length: up }, () => '..') : ['.']), ...to.slice(shared)];
  return steps.join('/');
}

/** The managed files armemon writes, by name, for a layout and a language. */
export const managedFile = {
  runtimeGenerated: (layout: AppLayout, language: AppLanguage) =>
    managedPath(layout, `runtime.generated.${language === 'javascript' ? 'js' : 'ts'}`),
  runtimeConfig: (layout: AppLayout, language: AppLanguage) =>
    managedPath(layout, `runtime.config.${language === 'javascript' ? 'js' : 'ts'}`),
  rootNavigator: (layout: AppLayout) => managedPath(layout, 'navigation', 'RootNavigator.tsx'),
  routeTypes: (layout: AppLayout) => managedPath(layout, 'navigation', 'types.ts'),
  linking: (layout: AppLayout) => managedPath(layout, 'navigation', 'navigation.config.ts'),
  navigationGlue: (layout: AppLayout) => managedPath(layout, 'navigation', 'index.ts'),
  storeConfig: (layout: AppLayout) => managedPath(layout, 'redux', 'store.config.ts'),
  reduxGlue: (layout: AppLayout) => managedPath(layout, 'redux', 'index.ts'),
  themeConfig: (layout: AppLayout) => managedPath(layout, 'ui', 'theme.config.ts'),
  uiGlue: (layout: AppLayout) => managedPath(layout, 'ui', 'index.ts'),
  splashConfig: (layout: AppLayout) => managedPath(layout, 'splash', 'splash.config.ts'),
  splashGlue: (layout: AppLayout) => managedPath(layout, 'splash', 'index.ts'),
  splashHide: (layout: AppLayout) => managedPath(layout, 'splash', 'hide.ts'),
  splashHideWeb: (layout: AppLayout) => managedPath(layout, 'splash', 'hide.web.ts'),
  essentialsConfig: (layout: AppLayout) => managedPath(layout, 'essentials', 'essentials.config.ts'),
  essentialsGlue: (layout: AppLayout) => managedPath(layout, 'essentials', 'index.ts'),
};
