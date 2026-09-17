/**
 * FILE: jsonOutput.test.ts
 * PATH: packages/cli-armemon/test/jsonOutput.test.ts
 *
 * WHAT: Every command's `--json` output has the same envelope, through the real binary.
 * WHY:  Scripts read these, and there was no contract: most had `ok`, init's didn't,
 *       `list` printed a bare array, and nothing versioned any of it.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeApp, scaffoldNavigation, type TestApp } from './support/screenApps';

const BIN = fileURLToPath(new URL('../dist/bin/armemon.js', import.meta.url));

let app: TestApp;
beforeEach(async () => {
  app = await makeApp();
  await scaffoldNavigation(app);
});
afterEach(async () => {
  await app.remove();
});

const cli = (args: string[], cwd = app.root) =>
  spawnSync(process.execPath, [BIN, ...args, '--json'], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, CI: 'true', FORCE_COLOR: '0' },
  });

describe('--json output', () => {
  it.each([
    ['list', ['list']],
    ['doctor', ['doctor']],
    ['create-screen', ['create-screen', 'Order', '--no-verify']],
    ['link list', ['link', 'list']],
    ['sync', ['sync', '--no-verify']],
    ['a failure', ['create-screen', 'Home', '--no-verify']],
    ["commander's own error", ['create-screen', 'Order', '--bogus']],
  ])('%s starts with schemaVersion and ok, and its exit code agrees', (_label, args) => {
    const result = cli(args);
    const output = JSON.parse(result.stdout) as Record<string, unknown>;

    expect(Object.keys(output).slice(0, 2)).toEqual(['schemaVersion', 'ok']);
    expect(output.schemaVersion).toBe(1);
    expect(result.status).toBe(output.ok ? 0 : 1);
  });

  it('init starts with the same envelope', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'armemon-json-'));
    try {
      const result = cli(['init', 'react-native', 'MyApp', '--dry-run', '--plugins', ''], cwd);
      expect(JSON.parse(result.stdout)).toMatchObject({ schemaVersion: 1, ok: true, dryRun: true });
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it('list gives its plugins under a key, not as a bare array', () => {
    const output = JSON.parse(cli(['list']).stdout) as { plugins: Array<{ pluginId: string }> };
    expect(output.plugins.map((plugin) => plugin.pluginId)).toContain('navigation');
  });
});
