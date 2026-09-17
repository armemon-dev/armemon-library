/**
 * FILE: patchResult.ts
 * PATH: packages/cli-kit/src/fs/patchResult.ts
 *
 * WHAT: What every edit armemon makes to an existing file reports back, and the four
 *       helpers that build it.
 * WHY:  The refusal semantics are the valuable part and they have to be identical
 *       everywhere. An edit reports one of four things — it changed the file, the
 *       file already said it, it refused because going ahead would break something,
 *       or it could not be done safely and here is what to do by hand. A second
 *       patcher re-implementing that from memory is how two commands come to disagree
 *       about what "already" means.
 *
 *       These lived inside navigatorPatcher.ts, which is 1188 lines about navigation
 *       specifically. The store-config patcher needs exactly the same contract and
 *       has nothing to do with navigators, so the contract moved here rather than
 *       being copied or bolted onto a module it doesn't belong in.
 * HOW:  `checked` is the one that matters: it re-parses the result and refuses the
 *       edit if it would leave the file unparsable, so a bad patch reports a problem
 *       instead of writing broken code.
 * WHEN: By every patcher in this package.
 *
 * EXPORTS: PatchResult, done, refused, brokenReason, checked, finish
 * DEPENDS ON: node:path, ./sourceEdit
 * USED BY: ./navigatorPatcher.ts, ./storeConfigPatcher.ts
 */

import path from 'node:path';
import { applyEdits, sourceSyntaxErrors, type TextEdit } from './sourceEdit.js';

export interface PatchResult {
  content: string;
  changed: boolean;
  /** Nothing changed because the file already says it — a re-run, not a problem. */
  already?: boolean;
  /** Refused because going ahead would break something: stop before writing. */
  conflict?: boolean;
  /** Why nothing changed. */
  reason?: string;
  /** What to change by hand, when armemon couldn't do it safely. */
  manual?: string;
  /** What an edit acted on, when it can act on several things. */
  names?: string[];
}

export const done = (content: string, reason: string): PatchResult => ({
  content,
  changed: false,
  already: true,
  reason,
});

export const refused = (
  content: string,
  reason: string,
  manual?: string,
  conflict = false,
): PatchResult => ({
  content,
  changed: false,
  reason,
  ...(manual ? { manual } : {}),
  ...(conflict ? { conflict: true } : {}),
});

/** Why this file can't be edited at all, or null when it parses. */
export function brokenReason(content: string, fileName: string): string | null {
  const errors = sourceSyntaxErrors(content, fileName);
  return errors.length > 0 ? `${path.basename(fileName)} doesn't parse as it is (${errors[0]})` : null;
}

/**
 * The result of an edit, having checked it didn't break the file.
 *
 * Re-parsing after the edit is what keeps a patcher honest: the edits are computed
 * from positions in the original source, and anything that got them wrong shows up
 * here as a syntax error rather than as a corrupted file on disk.
 */
export function checked(
  original: string,
  next: string,
  fileName: string,
  manual?: string,
  alreadyReason = 'nothing to change',
): PatchResult {
  if (next === original) return done(original, alreadyReason);
  const errors = sourceSyntaxErrors(next, fileName);
  if (errors.length > 0) {
    return refused(original, `the edit would leave ${path.basename(fileName)} unparsable (${errors[0]})`, manual);
  }
  return { content: next, changed: true };
}

export const finish = (
  content: string,
  edits: TextEdit[],
  fileName: string,
  manual?: string,
): PatchResult => checked(content, applyEdits(content, edits), fileName, manual);
