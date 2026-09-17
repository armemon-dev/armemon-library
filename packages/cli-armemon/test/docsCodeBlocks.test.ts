/**
 * FILE: docsCodeBlocks.test.ts
 * PATH: packages/cli-armemon/test/docsCodeBlocks.test.ts
 *
 * WHAT: Every TypeScript and JavaScript code block in the repo's docs parses.
 * WHY:  A section of docs/authoring-plugins.md was once pasted into the middle of the
 *       wizard example, splitting `filesToWrite: [ {` from its `path:` — the example
 *       plugin authors copy from stopped being code, and nothing noticed. The user
 *       guide's blocks are type-checked separately (guideSnippets.test.ts); this is
 *       the floor for every other doc: whatever else a snippet is, it is syntax.
 * HOW:  Parses each fenced block with TypeScript's parser, in the language its fence
 *       names. Parsing only — the snippets name packages and variables that don't
 *       exist here, by design.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const REPO = fileURLToPath(new URL('../../..', import.meta.url));

const KINDS: Record<string, ts.ScriptKind> = {
  ts: ts.ScriptKind.TS,
  typescript: ts.ScriptKind.TS,
  tsx: ts.ScriptKind.TSX,
  js: ts.ScriptKind.JS,
  javascript: ts.ScriptKind.JS,
  jsx: ts.ScriptKind.JSX,
};

async function markdownFiles(): Promise<string[]> {
  const docs = (await fs.readdir(path.join(REPO, 'docs'))).filter((name) => name.endsWith('.md'));
  return [
    ...docs.map((name) => path.join('docs', name)),
    'README.md',
    ...(await fs.readdir(path.join(REPO, 'packages'))).map((name) => path.join('packages', name, 'README.md')),
  ];
}

describe('code blocks in the docs', async () => {
  const files: string[] = [];
  for (const file of await markdownFiles()) {
    if (await fs.access(path.join(REPO, file)).then(() => true, () => false)) files.push(file);
  }

  it.each(files)('%s: every ts/tsx/js/jsx block parses', async (file) => {
    const text = await fs.readFile(path.join(REPO, file), 'utf8');
    const blocks = [...text.matchAll(/^```(\w+)\n([\s\S]*?)^```$/gm)];

    for (const [, language, code] of blocks) {
      const kind = KINDS[language!.toLowerCase()];
      if (kind === undefined) continue;

      const line = text.slice(0, text.indexOf(code!)).split('\n').length;
      const source = ts.createSourceFile(`block.${language}`, code!, ts.ScriptTarget.ESNext, true, kind);
      const errors = ((source as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? []).map(
        (d) => ts.flattenDiagnosticMessageText(d.messageText, ' '),
      );
      expect(errors, `${file}, the ${language} block at line ${line}`).toEqual([]);
    }
  });
});
