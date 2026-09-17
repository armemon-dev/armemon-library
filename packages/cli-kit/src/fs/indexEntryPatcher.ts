/**
 * FILE: indexEntryPatcher.ts
 * PATH: packages/cli-kit/src/fs/indexEntryPatcher.ts
 *
 * WHAT: Prepends side-effect import lines to the app's index.js, above everything
 *       the RN template already put there.
 * WHY:  Exactly one requirement needs this today and it is non-negotiable:
 *       react-native-gesture-handler must be imported as the VERY FIRST line of the
 *       entry file or the Drawer navigator's gesture system never initializes. That
 *       used to be a postInstallNote, which meant selecting Drawer produced an app
 *       that crashed on launch until the user read the note and edited a file by
 *       hand. Position matters here in a way it doesn't anywhere else, so this is
 *       its own small patcher rather than part of appEntryPatcher (which owns
 *       App.tsx and rewrites it wholesale).
 * HOW:  Reads index.js, skips any line already present (re-runs are idempotent),
 *       and writes the new lines above the existing content separated by a blank
 *       line. Unlike App.tsx and metro.config.js this file is APPENDED to rather
 *       than overwritten, because the RN template's index.js carries the
 *       AppRegistry registration the app genuinely needs.
 * WHEN: Called once, after all plans are collected, if any plugin contributed an
 *       entryPrelude.
 *
 *
 *       addEntryPrelude and removeEntryPrelude are the same edit as a pure function,
 *       for `armemon plugin add/remove`: a line goes in above the rest, beside any
 *       prelude already there, and comes out again with the blank line it brought.
 *
 * EXPORTS: prependToAppIndex, addEntryPrelude, removeEntryPrelude
 * DEPENDS ON: node:path, node:fs/promises, ./patchResult
 * USED BY: packages/cli-armemon/src/flows/initReactNative.ts,
 *          packages/cli-armemon/src/flows/plugins/reconcile.ts
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { checked, done, type PatchResult } from './patchResult.js';

export async function prependToAppIndex(appRoot: string, lines: string[]): Promise<void> {
  const unique = [...new Set(lines)].filter((line) => line.trim().length > 0);
  if (unique.length === 0) return;

  const indexPath = path.join(appRoot, 'index.js');
  const existing = await fs.readFile(indexPath, 'utf8').catch(() => null);
  if (existing === null) return;

  const missing = unique.filter((line) => !existing.includes(line));
  if (missing.length === 0) return;

  await fs.writeFile(indexPath, `${missing.join('\n')}\n\n${existing}`, 'utf8');
}

const manualPrelude = (lines: string[], verb: 'Add' | 'Remove') =>
  `${verb} ${lines.length === 1 ? 'this line' : 'these lines'} ${verb === 'Add' ? 'at the very top of' : 'from'} index.js:\n${lines.join('\n')}`;

/**
 * Puts `lines` at the top of index.js, the way init does.
 *
 * `existingPrelude` is what other plugins already put there: new lines join that
 * block instead of starting a second one above it, so the file reads as init would
 * have written it with every plugin at once.
 */
export function addEntryPrelude(content: string, lines: string[], existingPrelude: string[] = []): PatchResult {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const present = new Set(content.split(/\r?\n/).map((line) => line.trim()));
  const missing = [...new Set(lines)].filter((line) => line.trim().length > 0 && !present.has(line.trim()));
  if (missing.length === 0) return done(content, 'index.js already starts with these lines');

  const fileLines = content.split(/\r?\n/);
  const known = new Set(existingPrelude.map((line) => line.trim()));
  let blockEnd = 0;
  while (blockEnd < fileLines.length && known.has(fileLines[blockEnd]!.trim())) blockEnd += 1;

  const next =
    blockEnd > 0
      ? [...fileLines.slice(0, blockEnd), ...missing, ...fileLines.slice(blockEnd)].join(eol)
      : `${missing.join(eol)}${eol}${eol}${content}`;
  return checked(content, next, 'index.js', manualPrelude(missing, 'Add'));
}

/** Takes `lines` back out of index.js, with the blank line that separated them. */
export function removeEntryPrelude(content: string, lines: string[]): PatchResult {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const wanted = new Set(lines.map((line) => line.trim()).filter(Boolean));
  const fileLines = content.split(/\r?\n/);
  const kept: string[] = [];
  let removedAtTop = false;
  let removed = 0;

  for (const line of fileLines) {
    if (wanted.has(line.trim())) {
      removed += 1;
      if (kept.length === 0) removedAtTop = true;
      continue;
    }
    kept.push(line);
  }
  if (removed === 0) return done(content, 'index.js no longer has these lines');

  // The prelude block went in as "lines, blank line, the rest": once none of it is
  // left, the blank line it brought goes too.
  if (removedAtTop && kept.length > 1 && kept[0]!.trim() === '') kept.shift();
  return checked(content, kept.join(eol), 'index.js', manualPrelude([...wanted], 'Remove'));
}
