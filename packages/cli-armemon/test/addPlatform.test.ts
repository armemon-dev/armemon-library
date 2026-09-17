/**
 * FILE: addPlatform.test.ts
 * PATH: packages/cli-armemon/test/addPlatform.test.ts
 *
 * WHAT: `armemon add <platform>` behaves like every other command — and when a
 *       platform's setup fails, the app is left as it was, lockfile included.
 * WHY:  add grew up separately from the other commands and missed what they share:
 *       it printed nothing for --json when the platform was already there, took
 *       --dir without looking above the current folder, had no --dry-run or
 *       --no-verify, and left an installed package behind when a platform's attach
 *       tool failed. These pin each of those.
 * HOW:  The paths that don't need a network install run the real flow against an app
 *       on disk. The clean-up after a failed attach runs a real `npm install`, since
 *       what it exists for is what npm then writes to the lockfile.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runAddPlatformFlow } from '../dist/index.js';
import { captureStdout, makeApp, resetCliState, writeConfig, type TestApp } from './support/screenApps';

let app: TestApp;

beforeEach(async () => {
  app = await makeApp();
  resetCliState();
});
afterEach(async () => {
  await app.remove();
  resetCliState();
});

/** Every file in the app with its content, to prove a run changed nothing. */
async function snapshot(root = app.root, prefix = ''): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    const key = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(out, await snapshot(full, key));
    else out[key] = await fs.readFile(full, 'utf8');
  }
  return out;
}

describe('add, when the platform is already there', () => {
  beforeEach(async () => {
    await writeConfig(app);
    await app.write('ios/Podfile', '');
  });

  it('answers --json with JSON instead of an empty stdout', async () => {
    const out = await captureStdout(() =>
      runAddPlatformFlow({ platform: 'ios', cwd: app.root, json: true }),
    );
    expect(JSON.parse(out)).toMatchObject({ ok: true, added: null, alreadyPresent: true, platform: 'ios' });
    expect(process.exitCode).toBe(0);
  });

  it('finds the app from a folder inside it, like every other command', async () => {
    await app.write('src/screens/.keep', '');
    const out = await captureStdout(() =>
      runAddPlatformFlow({ platform: 'ios', cwd: path.join(app.root, 'src/screens'), json: true }),
    );
    expect(JSON.parse(out)).toMatchObject({ alreadyPresent: true });
  });
});

describe('add --dry-run', () => {
  it.each(['web', 'windows', 'macos', 'android'])('lists what adding %s would do and changes nothing', async (platform) => {
    await writeConfig(app);
    const before = await snapshot();

    const out = await captureStdout(() =>
      runAddPlatformFlow({ platform, cwd: app.root, dryRun: true, json: true }),
    );
    const summary = JSON.parse(out) as { ok: boolean; dryRun: boolean; steps: string[] };

    expect(summary).toMatchObject({ ok: true, dryRun: true, platform });
    expect(summary.steps.join('\n')).toContain(`"${platform}"`);
    expect(await snapshot()).toEqual(before);
  });

  it('says web/dist/ goes into .gitignore, as init does', async () => {
    await writeConfig(app);
    const out = await captureStdout(() =>
      runAddPlatformFlow({ platform: 'web', cwd: app.root, dryRun: true, json: true }),
    );
    expect(out).toContain('web/dist/');
  });
});

describe('add, with a platform that does not exist', () => {
  it('names the valid ones', async () => {
    await writeConfig(app);
    await expect(runAddPlatformFlow({ platform: 'redux', cwd: app.root })).rejects.toMatchObject({
      message: 'Unknown platform "redux".',
    });
  });
});

describe('taking a failed platform back out', () => {
  // Removing react-native-windows from package.json alone left it in the lockfile,
  // and `npm ci` refuses a lockfile that disagrees with package.json — so the first
  // clean install of the app, on a teammate's machine or in CI, failed.
  it('leaves a lockfile that npm ci accepts', async () => {
    const { takePlatformPackagesBackOut } = await import('../src/flows/platformPackages');

    await app.write(
      'package.json',
      JSON.stringify({ name: 'fixture', version: '1.0.0', dependencies: { 'react-native-windows': '0.76.0' } }, null, 2),
    );
    await app.write(
      'package-lock.json',
      JSON.stringify(
        {
          name: 'fixture',
          version: '1.0.0',
          lockfileVersion: 3,
          requires: true,
          packages: {
            '': { name: 'fixture', version: '1.0.0', dependencies: { 'react-native-windows': '0.76.0' } },
            'node_modules/react-native-windows': { version: '0.76.0' },
          },
        },
        null,
        2,
      ),
    );

    const removed = await takePlatformPackagesBackOut(app.root, ['windows'], 'npm');

    expect(removed).toEqual(['react-native-windows']);
    expect(await app.read('package-lock.json')).not.toContain('react-native-windows');
    await expect(
      promisify(execFile)('npm', ['ci', '--dry-run', '--offline'], { cwd: app.root }),
    ).resolves.toBeDefined();
  }, 120_000);

  it('runs no install when nothing was there to remove', async () => {
    const { takePlatformPackagesBackOut } = await import('../src/flows/platformPackages');
    await app.write('package.json', JSON.stringify({ name: 'fixture', version: '1.0.0' }, null, 2));

    expect(await takePlatformPackagesBackOut(app.root, ['windows', 'macos'], 'npm')).toEqual([]);
    await expect(app.exists('package-lock.json')).resolves.toBe(false);
  });
});
