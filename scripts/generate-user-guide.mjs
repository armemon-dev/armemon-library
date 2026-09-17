/**
 * Writes the generated docs from the CLI itself:
 *
 * - docs/user-guide.md — the guide armemon puts into every app as armemon/README.md,
 *   published in the repository for people who use the plugins without the CLI and
 *   so never get that file.
 * - packages/cli-armemon/README.md — the page npm shows for @armemon-library/cli,
 *   with the same command reference.
 *
 * Generated, not hand-kept: a test fails when either file stops matching.
 *
 * Run after building:  npm run docs:guide
 */
import fs from 'node:fs/promises';

const { createProgram, buildRepoUserGuide, buildCliReadme } = await import(
  '../packages/cli-armemon/dist/index.js'
);

const outputs = [
  ['docs/user-guide.md', buildRepoUserGuide(createProgram([]))],
  ['packages/cli-armemon/README.md', buildCliReadme(createProgram([]))],
];

for (const [relative, content] of outputs) {
  await fs.writeFile(new URL(`../${relative}`, import.meta.url), content, 'utf8');
  console.log(`Wrote ${relative} (${content.split('\n').length} lines).`);
}
