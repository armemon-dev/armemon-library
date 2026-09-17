/**
 * FILE: gitignorePatcher.ts
 * PATH: packages/cli-kit/src/fs/gitignorePatcher.ts
 *
 * WHAT: Appends entries to the scaffolded app's .gitignore, skipping any already
 *       present.
 * WHY:  The RN template's .gitignore has no `.env` entry (confirmed against a real
 *       0.76 scaffold — it only ignores `**\/.xcode.env.local`). armemon's env step
 *       writes `.env.example` and wires the Babel plugin that reads `.env`, so the
 *       very first secret a user puts in that file gets committed. Anything armemon
 *       teaches an app to create, armemon should teach git to ignore.
 * HOW:  Read-append-write under an "armemon" comment header so it's obvious which
 *       lines the tool added; missing file is treated as empty.
 * WHEN: Called once, after all plans are collected, with the union of every plugin's
 *       gitignoreEntries.
 *
 * EXPORTS: appendGitignoreEntries, gitignoreWithEntries
 * DEPENDS ON: node:path, node:fs/promises
 * USED BY: packages/cli-armemon/src/flows/initReactNative.ts
 */

import path from 'node:path';
import fs from 'node:fs/promises';

const HEADER = '# Added by armemon';

export async function appendGitignoreEntries(appRoot: string, entries: string[]): Promise<void> {
  const gitignorePath = path.join(appRoot, '.gitignore');
  const existing = await fs.readFile(gitignorePath, 'utf8').catch(() => '');
  const next = gitignoreWithEntries(existing, entries);
  if (next !== existing) await fs.writeFile(gitignorePath, next, 'utf8');
}

/** .gitignore with the entries it doesn't have yet appended under armemon's header. */
export function gitignoreWithEntries(existing: string, entries: string[]): string {
  const unique = [...new Set(entries)].filter((entry) => entry.trim().length > 0);
  const lines = new Set(
    existing
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  );
  const missing = unique.filter((entry) => !lines.has(entry.trim()));
  if (missing.length === 0) return existing;

  const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  return `${existing}${separator}\n${HEADER}\n${missing.join('\n')}\n`;
}
