/**
 * FILE: refresh.ts
 * PATH: packages/cli-armemon/src/flows/plugins/refresh.ts
 *
 * WHAT: Brings the app's plugin files in line with a new set of platforms — the files
 *       a plugin only writes for a platform, and the ones it writes differently.
 * WHY:  A plugin's output depends on the platforms: the splash plugin writes hide.web
 *       only for web, and its settings file names the platforms its native assets are
 *       generated for. `armemon add web` used to leave both as init had written them
 *       without web — so the web bundle fell back to the native hide, which has no web
 *       build, and `plugin remove splash` then took its untouched settings file for one
 *       someone had edited, and stopped.
 * HOW:  Replays every plugin's plan for the old platforms and the new, and compares.
 *       A file only the new platforms bring is written when nothing is at its path. A
 *       file both write is updated only while it is still exactly the old version;
 *       an edited one is left, and named.
 * WHEN: After `armemon add <platform>`.
 *
 * EXPORTS: refreshPluginFiles
 * DEPENDS ON: node:path, node:fs/promises, @armemon-library/config-types, ./appState, ./compose
 * USED BY: flows/addPlatform.ts
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import type { Platform } from '@armemon-library/config-types';
import { readAppState, replayPlans } from './appState.js';
import { compose, matchesGenerated } from './compose.js';

export interface RefreshResult {
  created: string[];
  updated: string[];
  /** Files the new platforms change, left because they were edited. */
  kept: string[];
}

export async function refreshPluginFiles(
  appRoot: string,
  cwd: string,
  platforms: { before: Platform[]; after: Platform[] },
): Promise<RefreshResult> {
  const result: RefreshResult = { created: [], updated: [], kept: [] };
  const state = await readAppState({ cwd, dir: appRoot });
  if (Object.keys(state.config.plugins).length === 0) return result;

  const was = { ...state, platforms: platforms.before };
  const will = { ...state, platforms: platforms.after };
  const before = await compose(was, (await replayPlans(was, state.config.plugins)).plans);
  const after = await compose(will, (await replayPlans(will, state.config.plugins)).plans);

  for (const [relative, file] of after.files) {
    const previous = before.files.get(relative);
    if (previous?.content === file.content) continue;
    const full = path.join(appRoot, ...relative.split('/'));
    const current = await fs.readFile(full, 'utf8').catch(() => null);

    if (current === null) {
      // Deleted on purpose is the app's decision; only a file the platform brings is new.
      if (previous) continue;
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, file.content, 'utf8');
      result.created.push(relative);
    } else if (previous && (await matchesGenerated(appRoot, current, previous.content, relative))) {
      await fs.writeFile(full, file.content, 'utf8');
      result.updated.push(relative);
    } else if (previous && !(await matchesGenerated(appRoot, current, file.content, relative))) {
      result.kept.push(relative);
    }
  }
  return result;
}
