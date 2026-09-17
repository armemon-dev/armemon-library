/**
 * Regression tests for the advanced-init built-in: the Prettier config that could
 * not resolve, the Babel plugins that fought over one file, dev tooling landing in
 * runtime dependencies, a deprecated tsconfig option, and a tsconfig edit that couldn't
 * be taken back out.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import wizard from '../dist/wizard/index.mjs';
import type { PluginInstallPlan, WizardContext } from '@armemon-library/config-types';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'armemon-adv-'));
  await fs.writeFile(
    path.join(tmp, 'tsconfig.json'),
    JSON.stringify({ extends: '@react-native/typescript-config/tsconfig.json' }, null, 2),
  );
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const ctx = (): WizardContext => ({
  appRoot: tmp,
  cwd: '/tmp',
  appName: 'MyApp',
  rnVersion: '0.76.0',
  packageManager: 'npm',
  platforms: ['ios', 'android'],
  language: 'typescript',
  flags: {},
  alreadyAnsweredByOtherPlugins: {},
});

const base = {
  envStrategy: 'react-native-dotenv' as const,
  pathAliases: true,
  bundleId: 'com.myapp',
  lintStyle: 'default' as const,
};

const fileAt = (plan: PluginInstallPlan, p: string) =>
  plan.filesToWrite.find((f) => f.path === p);

describe('dependency channels', () => {
  it('puts Babel plugins in devDependencies, not runtime dependencies', async () => {
    const plan = await wizard.plan(base, ctx());
    expect(plan.devDependencies?.['react-native-dotenv']).toBeDefined();
    expect(plan.devDependencies?.['babel-plugin-module-resolver']).toBeDefined();
    expect(plan.npmDependencies).toEqual({});
  });
});

describe('babel', () => {
  it('contributes both plugins instead of one overwriting the other', async () => {
    const plan = await wizard.plan(base, ctx());
    const joined = (plan.babelPlugins ?? []).join(' ');
    expect(joined).toContain('module:react-native-dotenv');
    expect(joined).toContain('module-resolver');
    // The path-alias half used to be a note asking the user to edit the file.
    expect(plan.postInstallNotes?.join(' ') ?? '').not.toMatch(/Add \['module-resolver'/);
  });

  it('writes no babel entries when both features are declined', async () => {
    const plan = await wizard.plan({ ...base, envStrategy: 'none', pathAliases: false }, ctx());
    expect(plan.babelPlugins).toBeUndefined();
  });
});

describe('env', () => {
  it('gitignores .env and generates @env type declarations', async () => {
    const plan = await wizard.plan(base, ctx());
    expect(plan.gitignoreEntries).toContain('.env');
    const types = fileAt(plan, 'src/types/env.d.ts')!;
    expect(types.content).toContain("declare module '@env'");
    expect(fileAt(plan, '.env')).toBeDefined();
    expect(fileAt(plan, '.env.example')).toBeDefined();
  });

  it('touches nothing env-related when declined', async () => {
    const plan = await wizard.plan({ ...base, envStrategy: 'none' }, ctx());
    expect(plan.gitignoreEntries).toBeUndefined();
    expect(fileAt(plan, '.env')).toBeUndefined();
  });
});

describe('path aliases', () => {
  it('merges only the alias into tsconfig.json, without the deprecated baseUrl', async () => {
    const plan = await wizard.plan(base, ctx());
    // Merged rather than written whole, so `armemon plugin remove` can take exactly
    // this key back out — and the template's extends is never the plan's to rewrite.
    expect(fileAt(plan, 'tsconfig.json')).toBeUndefined();
    expect(plan.jsonMerges).toEqual([
      { path: 'tsconfig.json', values: { compilerOptions: { paths: { '@/*': ['./src/*'] } } } },
    ]);
    // TypeScript 6 errors on baseUrl (TS5101) and 7 removes it.
    expect(JSON.stringify(plan.jsonMerges)).not.toContain('baseUrl');
  });

  it('merges nothing into a JavaScript app, which has no tsconfig.json', async () => {
    const plan = await wizard.plan(base, { ...ctx(), language: 'javascript' });
    expect(plan.jsonMerges).toBeUndefined();
    expect(plan.babelPlugins?.join(' ')).toContain('module-resolver');
  });

  it('is the same plan every time for the same answers', async () => {
    expect(JSON.stringify(await wizard.plan(base, ctx()))).toBe(JSON.stringify(await wizard.plan(base, ctx())));
  });
});

describe('prettier', () => {
  it('inlines the values rather than requiring a package RN does not install', async () => {
    const plan = await wizard.plan({ ...base, lintStyle: 'opinionated' }, ctx());
    const prettier = fileAt(plan, '.prettierrc.js')!;
    // require('@react-native/prettier-config') threw MODULE_NOT_FOUND in real scaffolds.
    expect(prettier.content).not.toContain("require('@react-native/prettier-config')");
    expect(prettier.content).toContain('singleQuote: true');
  });

  it('writes no prettier config for the default style', async () => {
    const plan = await wizard.plan(base, ctx());
    expect(fileAt(plan, '.prettierrc.js')).toBeUndefined();
  });
});

describe('bundle id', () => {
  it('stays silent when no native project exists to disagree with', async () => {
    const plan = await wizard.plan(base, ctx());
    expect(plan.postInstallNotes?.join(' ') ?? '').not.toMatch(/Bundle identifier/);
  });

  it('reports the real generated identifier when it differs', async () => {
    await fs.mkdir(path.join(tmp, 'android/app'), { recursive: true });
    await fs.writeFile(
      path.join(tmp, 'android/app/build.gradle'),
      'android {\n  defaultConfig {\n    applicationId "com.myapp"\n  }\n}\n',
    );
    const plan = await wizard.plan({ ...base, bundleId: 'com.acme.myapp' }, ctx());
    expect(plan.postInstallNotes?.join(' ')).toContain('com.myapp');
    expect(plan.postInstallNotes?.join(' ')).toContain('com.acme.myapp');
  });
});
