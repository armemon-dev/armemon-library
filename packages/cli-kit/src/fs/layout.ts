/**
 * FILE: layout.ts
 * PATH: packages/cli-kit/src/fs/layout.ts
 *
 * WHAT: The app's two zones as the CLI sees them — the pure definitions from
 *       @armemon-library/config-types, plus the one question that needs the disk: which layout
 *       a given app actually has.
 * WHY:  The constants and path maths live in config-types so a plugin wizard can build
 *       a managed path without depending on the CLI toolkit. Everything in the CLI
 *       reaches them through cli-kit like every other helper, and only the CLI ever
 *       needs to ask an app on disk where its managed zone is: `armemon/` for apps
 *       scaffolded now, `src/armemon/` for ones scaffolded before the move.
 * HOW:  Re-export, plus readLayout(): one stat per candidate, current layout by default.
 * WHEN: At the start of every command that edits an app.
 *
 * EXPORTS: everything from config-types' layout, readLayout, managedRoot
 * DEPENDS ON: node:path, node:fs/promises, @armemon-library/config-types
 * USED BY: packages/cli-armemon/src/flows/*, ./navigationDiscovery.ts, ../codegen/*
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { DEFAULT_LAYOUT, LEGACY_LAYOUT, MANAGED_DIR, type AppLayout } from '@armemon-library/config-types';

// Named rather than `export *`: config-types has no ./layout subpath, and re-exporting
// the whole package from cli-kit's barrel would collide with its own names.
export {
  MANAGED_DIR,
  LEGACY_MANAGED_DIR,
  WORKSPACE_DIR,
  SCREENS_DIR,
  SHARED_DIR,
  SLICES_DIR,
  EXAMPLES_DIR,
  DEFAULT_LAYOUT,
  LEGACY_LAYOUT,
  layoutOf,
  managedPath,
  workspacePath,
  isManaged,
  specifierFor,
  managedFile,
  type AppLayout,
} from '@armemon-library/config-types';

async function isDirectory(target: string): Promise<boolean> {
  return fs.stat(target).then((stat) => stat.isDirectory()).catch(() => false);
}

/**
 * Which layout this app has. An app that has neither folder yet — a fresh scaffold —
 * gets the current one; an app that only has src/armemon/ keeps being read where it is.
 */
export async function readLayout(appRoot: string): Promise<AppLayout> {
  if (await isDirectory(path.join(appRoot, MANAGED_DIR))) return DEFAULT_LAYOUT;
  if (await isDirectory(path.join(appRoot, 'src', MANAGED_DIR))) return LEGACY_LAYOUT;
  return DEFAULT_LAYOUT;
}

/** The absolute path of the managed zone. */
export function managedRoot(appRoot: string, layout: AppLayout): string {
  return path.join(appRoot, ...layout.managed.split('/'));
}
