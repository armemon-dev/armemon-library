/**
 * FILE: doctor.test.ts
 * PATH: packages/cli-armemon/test/doctor.test.ts
 *
 * WHAT: `armemon doctor` through the real built binary.
 * WHY:  doctor is a CI gate, so a wrong answer costs a red build or a false green.
 *       It checked relative file: links against wherever it was run from, reported
 *       a runtime.generated that registers nothing as "Present and registers a
 *       runtime config", and — alone among the commands — neither took --dir nor
 *       looked above the current folder for the app.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeApp, writeConfig, type TestApp } from './support/screenApps';

const BIN = fileURLToPath(new URL('../dist/bin/armemon.js', import.meta.url));

let app: TestApp;

beforeEach(async () => {
  app = await makeApp();
});
afterEach(async () => {
  await app.remove();
});

interface Report {
  appRoot: string;
  ok: boolean;
  checks: { name: string; ok: boolean; detail: string }[];
}

const doctor = (args: string[], cwd = app.root) => {
  const result = spawnSync(process.execPath, [BIN, 'doctor', '--json', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, CI: 'true', FORCE_COLOR: '0' },
  });
  return { status: result.status, report: JSON.parse(result.stdout) as Report };
};

const check = (report: Report, name: string) => report.checks.find((entry) => entry.name === name)!;

/** An app that passes: wired entry, generated runtime, and a relative file: link that exists. */
async function healthyApp(): Promise<void> {
  await writeConfig(app);
  await app.write('armemon/runtime.generated.ts', 'registerRuntimeConfig({ plugins: [], userTasks: [] });\n');
  await app.write('armemon/runtime.config.ts', 'export const userTasks = [];\n');
  await app.write('vendor/core/package.json', '{"name":"@armemon-library/core"}');
  await app.write(
    'package.json',
    JSON.stringify({ name: 'fixture', dependencies: { '@armemon-library/core': 'file:./vendor/core' } }, null, 2),
  );
  await app.write('metro.config.js', 'module.exports = { watchFolders: [] };\n');
}

describe('doctor', () => {
  it('passes a healthy app', async () => {
    await healthyApp();
    const { status, report } = doctor([]);
    expect(report.checks.filter((entry) => !entry.ok)).toEqual([]);
    expect(status).toBe(0);
  });

  it('resolves a relative file: link against the app, not the folder doctor runs in', async () => {
    await healthyApp();
    const { report } = doctor([path.basename(app.root)], path.dirname(app.root));
    expect(check(report, 'local package links')).toMatchObject({ ok: true });
  });

  it('finds the app from a folder inside it', async () => {
    await healthyApp();
    await app.write('src/screens/.keep', '');
    const { report } = doctor([], path.join(app.root, 'src/screens'));
    expect(report.appRoot).toBe(app.root);
    expect(report.ok).toBe(true);
  });

  it('takes --dir, like every other command', async () => {
    await healthyApp();
    const { report } = doctor(['--dir', app.root], path.dirname(app.root));
    expect(report.appRoot).toBe(app.root);
  });

  it("doesn't call a runtime.generated that registers nothing registered", async () => {
    await healthyApp();
    await app.write('armemon/runtime.generated.ts', 'export {};\n');

    const { status, report } = doctor([]);
    const generated = check(report, 'runtime.generated');
    expect(generated.ok).toBe(false);
    expect(generated.detail).not.toContain('registers a runtime config.');
    expect(generated.detail).toContain('never calls registerRuntimeConfig');
    expect(status).toBe(1);
  });

  it('never suggests re-running init, which refuses an existing folder', async () => {
    await healthyApp();
    await app.remove();
    await healthyApp();
    await import('node:fs/promises').then((fs) => fs.rm(path.join(app.root, 'armemon/runtime.generated.ts')));

    const { report } = doctor([]);
    expect(check(report, 'runtime.generated').detail).not.toMatch(/armemon init/);
  });

  it('reports an invalid config as a failed check, and still runs the others', async () => {
    await healthyApp();
    await app.write('armemon.config.ts', 'const config = { "appName": "MyApp", "rnVersion": "0.76.0", "platforms": ["andriod"], "packageManager": "npm", "plugins": {} };\nexport default config;\n');

    const { status, report } = doctor([]);
    expect(check(report, 'armemon.config')).toMatchObject({ ok: false, detail: expect.stringContaining('"andriod"') });
    expect(check(report, 'runtime.generated')).toMatchObject({ ok: true });
    expect(status).toBe(1);
  });

  it('wants web/dist/ ignored in an app with a web target', async () => {
    await healthyApp();
    const config = JSON.parse((await app.read('armemon.config.ts')).replace(/^const config = |;\nexport default config;\n$/g, ''));
    await app.write(
      'armemon.config.ts',
      `const config = ${JSON.stringify({ ...config, platforms: ['ios', 'web'] })};\nexport default config;\n`,
    );

    expect(check(doctor([]).report, 'web build output ignored by git')).toMatchObject({ ok: false });
    await app.write('.gitignore', 'node_modules/\nweb/dist/\n');
    expect(check(doctor([]).report, 'web build output ignored by git')).toMatchObject({ ok: true });
  });

  it('notices an @/ alias declared for TypeScript but not for Metro', async () => {
    await healthyApp();
    await app.write('tsconfig.json', '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }\n');

    const alias = check(doctor([]).report, '@/ import alias');
    expect(alias.ok).toBe(false);
    expect(alias.detail).toContain('babel.config.js');

    await app.write(
      'babel.config.js',
      "module.exports = { plugins: [['module-resolver', { root: ['./src'], alias: { '@': './src' } }]] };\n",
    );
    expect(check(doctor([]).report, '@/ import alias')).toMatchObject({ ok: true });
  });

  it('notices a lockfile out of step with package.json, which npm ci would refuse', async () => {
    await healthyApp();
    const pkg = JSON.parse(await app.read('package.json'));
    await app.write(
      'package-lock.json',
      JSON.stringify({
        lockfileVersion: 3,
        packages: { '': { dependencies: { ...pkg.dependencies, 'react-native-windows': '0.76.0' } } },
      }),
    );

    const lock = check(doctor([]).report, 'package-lock.json matches package.json');
    expect(lock.ok).toBe(false);
    expect(lock.detail).toContain('react-native-windows');
  });
});
