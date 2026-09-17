/**
 * FILE: upgrade.test.ts
 * PATH: packages/cli-armemon/test/upgrade.test.ts
 *
 * WHAT: `armemon upgrade` — which versions it moves an app to, and that a failed
 *       install leaves the app exactly as it was.
 * WHY:  An app's `^0.1.0` never reaches 0.2.0 on its own, so this is the only way an
 *       app follows the CLI forward. Getting the target wrong puts mismatched packages
 *       in an app; getting the failure path wrong leaves package.json naming versions
 *       that were never installed.
 * HOW:  A fake installed CLI — its packages under node_modules, the way npm lays out a
 *       published install — stands in for the real one, which runs from this checkout.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runUpgradeFlow } from '../dist/index.js';
import { captureStdout, makeApp, resetCliState, writeConfig, type TestApp } from './support/screenApps';

let app: TestApp;
let cli: string;

beforeEach(async () => {
  app = await makeApp();
  resetCliState();
  await writeConfig(app);

  // A published CLI: its own copies of the packages, at the versions it shipped with.
  cli = await fs.mkdtemp(path.join(os.tmpdir(), 'armemon-installed-cli-'));
  for (const [name, version] of [['core', '0.3.0'], ['redux', '0.3.1']]) {
    const dir = path.join(cli, 'node_modules', '@armemon-library', name);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: `@armemon-library/${name}`, version }));
  }
});

afterEach(async () => {
  await app.remove();
  await fs.rm(cli, { recursive: true, force: true });
  resetCliState();
});

const packageJson = {
  name: 'fixture',
  dependencies: {
    react: '18.3.1',
    '@armemon-library/core': '^0.1.0',
    '@armemon-library/redux': '^0.1.0',
    '@armemon-library/someone-elses': '^1.0.0',
  },
};

const upgrade = (options: Record<string, unknown> = {}) =>
  runUpgradeFlow({ cwd: app.root, allAccept: true, verify: false, resolveFrom: [cli], ...options });

describe('upgrade', () => {
  it('refuses when the CLI runs from its source checkout, which has no published versions', async () => {
    await app.write('package.json', JSON.stringify(packageJson));
    await expect(runUpgradeFlow({ cwd: app.root, allAccept: true })).rejects.toMatchObject({
      message: expect.stringContaining('source checkout'),
    });
  });

  it("--dry-run lists each package's move to the CLI's version and changes nothing", async () => {
    await app.write('package.json', JSON.stringify(packageJson));
    const before = await app.read('package.json');

    const summary = JSON.parse(await captureStdout(() => upgrade({ dryRun: true, json: true }))) as {
      upgraded: Array<{ name: string; from: string; to: string }>;
      unknown: string[];
    };

    expect(summary.upgraded).toEqual([
      { name: '@armemon-library/core', field: 'dependencies', from: '^0.1.0', to: '^0.3.0' },
      { name: '@armemon-library/redux', field: 'dependencies', from: '^0.1.0', to: '^0.3.1' },
    ]);
    // Not a package this CLI ships, so nothing to move it to.
    expect(summary.unknown).toEqual(['@armemon-library/someone-elses']);
    expect(await app.read('package.json')).toBe(before);
  });

  it('says there is nothing to do when the app already matches', async () => {
    await app.write(
      'package.json',
      JSON.stringify({ name: 'fixture', dependencies: { '@armemon-library/core': '^0.3.0' } }),
    );
    const summary = JSON.parse(await captureStdout(() => upgrade({ json: true })));
    expect(summary).toMatchObject({ ok: true, upgraded: [] });
  });

  it.skipIf(process.platform === 'win32')('puts package.json back when the install fails', async () => {
    await app.write('package.json', JSON.stringify(packageJson));
    const before = await app.read('package.json');

    // An npm that always fails, first on PATH.
    const bin = await fs.mkdtemp(path.join(os.tmpdir(), 'armemon-fake-npm-'));
    await fs.writeFile(path.join(bin, 'npm'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const originalPath = process.env.PATH;
    process.env.PATH = `${bin}${path.delimiter}${originalPath}`;
    try {
      await expect(upgrade()).rejects.toMatchObject({ message: expect.stringContaining('package.json was put back') });
      expect(await app.read('package.json')).toBe(before);
    } finally {
      process.env.PATH = originalPath;
      await fs.rm(bin, { recursive: true, force: true });
    }
  });
});
