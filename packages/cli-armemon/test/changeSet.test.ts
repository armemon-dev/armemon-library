/**
 * FILE: changeSet.test.ts
 * PATH: packages/cli-armemon/test/changeSet.test.ts
 *
 * WHAT: The all-or-nothing writer every editing command shares — reading, staging,
 *       committing, and the diff --dry-run prints.
 * WHY:  Everything here runs on every command, so a cost that scales badly or a write
 *       that can't land shows up everywhere at once. The diff allocated a full table
 *       for two long files that differed by a line; every read went back to disk, so
 *       remove-screen's barrel scan re-read the same files over and over.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChangeSet, commit, lineDiff } from '../dist/index.js';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'armemon-changeset-'));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('lineDiff', () => {
  const numbered = (count: number, prefix = 'line') =>
    Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`).join('\n');

  it('shows a one-line change in a long file as exactly that, at its real line number', () => {
    const before = numbered(20_000);
    const after = before.replace('line 12345\n', 'line 12345 (edited)\n');

    const started = performance.now();
    expect(lineDiff(before, after)).toEqual([
      '+ 12345 │ line 12345 (edited)',
      '- 12345 │ line 12345',
    ]);
    // Comparing all 20,000 lines against each other was 400 million cells.
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('numbers an added line by where it lands', () => {
    expect(lineDiff('a\nb\nc', 'a\nb\nnew\nc')).toEqual(['+    3 │ new']);
  });

  it('shows a new file as every line added', () => {
    expect(lineDiff('', 'one\ntwo')).toEqual(['+    1 │ one', '+    2 │ two']);
  });

  it('declines to preview two long files that differ throughout', () => {
    expect(lineDiff(numbered(3000, 'old'), numbered(3000, 'new'))).toEqual(['(too large to preview)']);
  });
});

describe('ChangeSet.read', () => {
  it('reads a file from disk once per run, and staged content after that', async () => {
    const file = path.join(root, 'a.ts');
    await fs.writeFile(file, 'first\n');
    const changes = new ChangeSet(root);

    expect(await changes.read(file)).toBe('first\n');
    // Nothing is written until commit, so the disk is not expected to move under a
    // run; a second read comes from memory.
    await fs.writeFile(file, 'changed behind its back\n');
    expect(await changes.read(file)).toBe('first\n');

    await changes.stage(file, 'staged\n');
    expect(await changes.read(file)).toBe('staged\n');
    expect(changes.changes[0]?.before).toBe('first\n');
  });

  it('remembers that a file does not exist', async () => {
    const changes = new ChangeSet(root);
    expect(await changes.read(path.join(root, 'nope.ts'))).toBeNull();
  });
});

describe('commit', () => {
  it('writes a staged file into a folder that does not exist yet', async () => {
    const changes = new ChangeSet(root);
    const file = path.join(root, 'src/shared/hooks/useThing.ts');
    await changes.stage(file, 'export {};\n', null);

    await commit(changes);
    expect(await fs.readFile(file, 'utf8')).toBe('export {};\n');
  });

  it('takes a folder it made back out when a later write fails', async () => {
    await fs.writeFile(path.join(root, 'blocker'), 'a file\n');
    const changes = new ChangeSet(root);
    await changes.stage(path.join(root, 'fresh/nested/a.ts'), 'export {};\n', null);
    await changes.stage(path.join(root, 'blocker/b.ts'), 'export {};\n', null);

    await expect(commit(changes)).rejects.toThrow(/put back/);
    await expect(fs.access(path.join(root, 'fresh'))).rejects.toThrow();
  });
});
