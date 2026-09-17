/**
 * FILE: formatting.test.ts
 * PATH: packages/cli-kit/test/formatting.test.ts
 *
 * WHAT: The two formatters — one for files armemon generates, one for files that
 *       already exist in the app and are being re-aligned.
 * WHY:  Neither guarantee is reachable from the rest of the suite. No fixture app
 *       ships a .prettierrc, so every other test exercises only the fallback path:
 *       if the config merge were backwards — armemon's defaults winning over the
 *       project's — all 663 tests would stay green while armemon rewrote a real
 *       project's style on every command. And the line-ending guarantee was a live
 *       defect: re-align ran with prettier's "lf" default and normalised a CRLF
 *       checkout, turning a one-screen change into a whole-file diff on Windows.
 * HOW:  Write a file next to a config that declares the OPPOSITE of armemon's style
 *       and check whose rules come out.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { formatGeneratedSource, formatManagedSource } from '../dist/index.js';

const MESSY = "const a = {b: 1, c: 2}\nexport function f(x) { return x }\n";

const made: string[] = [];

async function appWith(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'armemon-format-'));
  made.push(dir);
  for (const [name, content] of Object.entries(files)) {
    await fs.writeFile(path.join(dir, name), content, 'utf8');
  }
  return dir;
}

afterEach(async () => {
  await Promise.all(made.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('formatManagedSource', () => {
  it("uses armemon's style when the project has no prettier config", async () => {
    const dir = await appWith({});
    const out = await formatManagedSource(MESSY, path.join(dir, 'sample.ts'));

    expect(out).toContain('return x;');
    expect(out).toContain("const a = { b: 1, c: 2 };");
  });

  it("follows the project's prettier config over armemon's defaults", async () => {
    // Every value here is the opposite of what armemon would choose.
    const dir = await appWith({
      '.prettierrc': JSON.stringify({ semi: false, singleQuote: false, tabWidth: 4 }),
    });
    const out = await formatManagedSource(MESSY, path.join(dir, 'sample.ts'));

    expect(out).not.toContain('return x;');
    expect(out).toContain('\n    return x');
  });

  /**
   * The one thing re-alignment must never do. It reformats files that are already in
   * the user's repository, so rewriting their line endings would put every file it
   * touches into the next commit.
   */
  it('keeps CRLF line endings instead of normalising them', async () => {
    const dir = await appWith({});
    const out = await formatManagedSource(MESSY.replace(/\n/g, '\r\n'), path.join(dir, 'sample.ts'));

    expect(out).toContain('\r\n');
    expect(out.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('returns the input unchanged when it cannot be parsed', async () => {
    const dir = await appWith({});
    const broken = 'const a = {{{\n';
    expect(await formatManagedSource(broken, path.join(dir, 'sample.ts'))).toBe(broken);
  });
});

describe('formatGeneratedSource', () => {
  it("uses armemon's style regardless of the project's config", async () => {
    // Generated content is armemon's own, so the project's rules do not apply to it —
    // the language conversion depends on getting a known shape back.
    const dir = await appWith({ '.prettierrc': JSON.stringify({ semi: false, tabWidth: 8 }) });
    const out = await formatGeneratedSource(MESSY, path.join(dir, 'sample.ts'));

    expect(out).toContain('return x;');
    expect(out).toContain('\n  return x;');
  });

  it('keeps CRLF line endings', async () => {
    const dir = await appWith({});
    const out = await formatGeneratedSource(MESSY.replace(/\n/g, '\r\n'), path.join(dir, 'sample.ts'));
    expect(out.replace(/\r\n/g, '')).not.toContain('\n');
  });
});
