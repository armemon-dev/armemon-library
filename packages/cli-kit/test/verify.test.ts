/**
 * armemon checking its own output.
 *
 * Two bugs reached a user in one day — a `web` script naming vite.config.ts in a
 * JavaScript app where the file is vite.config.js, and an index.html still pointing
 * at the pre-conversion entry — and armemon printed "Done, no manual wiring needed"
 * for both. Neither is visible to a type checker, and neither shows up until the
 * user types the command. A scaffolder that hands over a broken app and calls it
 * finished has failed at its one job, so it now runs the commands it promised.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { verifyGeneratedApp } from '../dist/index.js';

let appRoot: string;

const writePackageJson = (scripts: Record<string, string>) =>
  fs.writeFile(
    path.join(appRoot, 'package.json'),
    JSON.stringify({ name: 'app', scripts }, null, 2),
  );

beforeEach(async () => {
  appRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'armemon-verify-'));
});
afterEach(async () => {
  await fs.rm(appRoot, { recursive: true, force: true });
});

describe('script path checking', () => {
  it('catches a script naming a file that does not exist', async () => {
    // Exactly the bug that shipped: conversion renamed the config, the script
    // did not follow.
    await writePackageJson({ 'web:build': 'vite build --config web/vite.config.ts' });

    const report = await verifyGeneratedApp({
      appRoot,
      isTypeScript: false,
      hasWeb: false,
      packageManager: 'npm',
    });

    expect(report.ok).toBe(false);
    const check = report.checks.find((entry) => entry.name === 'package.json scripts')!;
    expect(check.ok).toBe(false);
    expect(check.detail).toContain('web/vite.config.ts');
    expect(check.detail).toContain("doesn't exist");
  });

  it('passes once the path is right', async () => {
    await fs.mkdir(path.join(appRoot, 'web'), { recursive: true });
    await fs.writeFile(path.join(appRoot, 'web/vite.config.js'), '');
    await writePackageJson({ 'web:build': 'vite build --config web/vite.config.js' });

    const report = await verifyGeneratedApp({
      appRoot,
      isTypeScript: false,
      hasWeb: false,
      packageManager: 'npm',
    });
    expect(report.ok).toBe(true);
  });

  it('ignores scripts with no file paths in them', async () => {
    await writePackageJson({
      android: 'react-native run-android',
      start: 'react-native start',
      test: 'jest',
    });
    const report = await verifyGeneratedApp({
      appRoot,
      isTypeScript: false,
      hasWeb: false,
      packageManager: 'npm',
    });
    expect(report.ok).toBe(true);
  });

  it('names every broken script, not just the first', async () => {
    await writePackageJson({
      web: 'vite --config web/vite.config.ts',
      'web:build': 'vite build --config web/missing.ts',
    });
    const check = (
      await verifyGeneratedApp({
        appRoot,
        isTypeScript: false,
        hasWeb: false,
        packageManager: 'npm',
      })
    ).checks[0]!;
    expect(check.detail).toContain('web/vite.config.ts');
    expect(check.detail).toContain('web/missing.ts');
  });

  it('skips the type-check for a JavaScript app', async () => {
    await writePackageJson({});
    const report = await verifyGeneratedApp({
      appRoot,
      isTypeScript: false,
      hasWeb: false,
      packageManager: 'npm',
    });
    expect(report.checks.map((entry) => entry.name)).toEqual(['package.json scripts']);
  });
});

describe('planned changes must actually land', () => {
  // The failure this exists for: the flow matched the web index by an exact
  // 'index.html', the file moved to 'web/index.html', and every htmlContribution —
  // the entire web splash — was dropped in silence. The app still built, so every
  // other check stayed green. Building is not the same as doing what was asked.
  it('catches markup a plugin contributed that never reached index.html', async () => {
    await writePackageJson({});
    await fs.mkdir(path.join(appRoot, 'web'), { recursive: true });
    await fs.writeFile(path.join(appRoot, 'web/index.html'), '<html><body></body></html>');

    const report = await verifyGeneratedApp({
      appRoot,
      isTypeScript: false,
      hasWeb: false,
      packageManager: 'npm',
      expectations: { htmlSnippets: ['<div id="armemon-splash"></div>'] },
    });

    expect(report.ok).toBe(false);
    const check = report.checks.find((entry) => entry.name === 'planned changes applied')!;
    expect(check.detail).toContain('web/index.html is missing a planned entry');
  });

  it('passes once the markup is there', async () => {
    await writePackageJson({});
    await fs.mkdir(path.join(appRoot, 'web'), { recursive: true });
    await fs.writeFile(
      path.join(appRoot, 'web/index.html'),
      '<html><body>\n    <div id="armemon-splash"></div>\n</body></html>',
    );

    const report = await verifyGeneratedApp({
      appRoot,
      isTypeScript: false,
      hasWeb: false,
      packageManager: 'npm',
      expectations: { htmlSnippets: ['<div id="armemon-splash"></div>'] },
    });
    expect(report.ok).toBe(true);
  });

  it('catches a planned file that was never written', async () => {
    await writePackageJson({});
    const report = await verifyGeneratedApp({
      appRoot,
      isTypeScript: false,
      hasWeb: false,
      packageManager: 'npm',
      expectations: { files: ['src/armemon/splash/index.js'] },
    });
    expect(report.ok).toBe(false);
    expect(report.checks[1]!.detail).toContain('planned but not written');
  });

  it('catches a babel plugin and an entry prelude line that went missing', async () => {
    await writePackageJson({});
    await fs.writeFile(path.join(appRoot, 'babel.config.js'), 'module.exports = {};');
    await fs.writeFile(path.join(appRoot, 'index.js'), "import {AppRegistry} from 'react-native';");

    const report = await verifyGeneratedApp({
      appRoot,
      isTypeScript: false,
      hasWeb: false,
      packageManager: 'npm',
      expectations: {
        babelPlugins: ["'react-native-reanimated/plugin'"],
        entryPrelude: ["import 'react-native-gesture-handler';"],
      },
    });
    expect(report.ok).toBe(false);
    expect(report.checks[1]!.detail).toContain('babel.config.js is missing');
    expect(report.checks[1]!.detail).toContain('index.js is missing');
  });
});
