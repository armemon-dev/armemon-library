/**
 * FILE: initCli.test.ts
 * PATH: packages/cli-armemon/test/initCli.test.ts
 *
 * WHAT: `armemon init react-native --json` through the real built binary, with no
 *       terminal attached.
 * WHY:  --json is for scripts, and every other command already made it imply
 *       --all-accept. init didn't: with no --rn-version or --pm it still asked, so in
 *       a terminal the question was drawn over the JSON and in CI it failed because
 *       nobody could answer. The README's "non-interactive" example hit exactly that.
 * HOW:  --dry-run, so nothing is scaffolded or installed; spawnSync gives the child a
 *       pipe for stdin, which is what CI gives it too.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const BIN = fileURLToPath(new URL('../dist/bin/armemon.js', import.meta.url));

let cwd: string;

beforeEach(async () => {
  cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'armemon-init-'));
});
afterEach(async () => {
  await fs.rm(cwd, { recursive: true, force: true });
});

describe('init react-native --json', () => {
  it('asks nothing: every unanswered choice takes its default, and stdout is only JSON', () => {
    const result = spawnSync(
      process.execPath,
      [BIN, 'init', 'react-native', 'MyApp', '--json', '--dry-run', '--plugins', ''],
      { cwd, encoding: 'utf8', env: { ...process.env, CI: 'true', FORCE_COLOR: '0' } },
    );

    expect(result.stderr).not.toMatch(/interactive|TTY/i);
    expect(result.status).toBe(0);
    const summary = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(summary).toMatchObject({ appName: 'MyApp' });
  });
});

/**
 * `compatibleWith.rnMin` was part of the manifest contract and nothing read it, so a
 * plugin needing a newer React Native was installed into an app that couldn't run it.
 */
describe('init react-native, with a plugin that needs a newer React Native', () => {
  const init = (args: string[]) =>
    spawnSync(process.execPath, [BIN, 'init', 'react-native', 'MyApp', '--json', '--dry-run', ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, CI: 'true', FORCE_COLOR: '0' },
    });

  beforeEach(async () => {
    await fs.writeFile(
      path.join(cwd, 'package.json'),
      JSON.stringify({ name: 'workspace', dependencies: { 'armemon-plugin-future': '1.0.0' } }),
    );
    await fs.mkdir(path.join(cwd, 'node_modules', 'armemon-plugin-future'), { recursive: true });
    await fs.writeFile(
      path.join(cwd, 'node_modules', 'armemon-plugin-future', 'package.json'),
      JSON.stringify({
        name: 'armemon-plugin-future',
        version: '1.0.0',
        armemon: {
          manifestVersion: 1,
          pluginId: 'future',
          displayName: 'Future',
          description: 'Needs a new React Native.',
          runtimeExportName: 'FuturePlugin',
          compatibleWith: { rnMin: '0.90.0' },
        },
      }),
    );
  });

  it('leaves it out, and says why', () => {
    const result = init(['--rn-version', '0.76.0']);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('Leaving out Future: it needs React Native 0.90.0 or newer');
    expect((JSON.parse(result.stdout) as { plugins: string[] }).plugins).not.toContain('future');
  });

  it('refuses it by name, with the version it needs', () => {
    const result = init(['--rn-version', '0.76.0', '--plugins', 'future']);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { message: 'Future needs React Native 0.90.0 or newer, and this app is getting 0.76.0.' },
    });
  });

  it('offers it when the app gets a new enough React Native', () => {
    const result = init(['--rn-version', '0.90.1', '--plugins', 'future']);
    expect(result.status).toBe(0);
    expect((JSON.parse(result.stdout) as { plugins: string[] }).plugins).toContain('future');
  });
});
