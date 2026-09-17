/**
 * FILE: pluginApps.ts
 * PATH: packages/cli-armemon/test/support/pluginApps.ts
 *
 * WHAT: A plugin-free app on disk, holding what `armemon init --plugins ""` writes, and
 *       a stand-in `npm` for the plugin commands' install step.
 * WHY:  `plugin add` and `plugin remove` edit a dozen files init generates. Testing them
 *       against hand-written approximations would test the approximations; this builds
 *       the app from the same generators init calls, in the same order, so a suite that
 *       passes here is passing against the files users have.
 *
 *       The install is the one step replaced: the rules are about what armemon writes and
 *       what it puts back when the install fails, and a stand-in that can be told to fail
 *       tests that without a registry.
 * HOW:  React Native's own template files first (0.76's, verbatim where armemon reads
 *       them), then armemon's output for no plugins — linked from this checkout, as an
 *       app made by this CLI is.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  appendGitignoreEntries,
  buildArmemonDependencySpecifier,
  buildScreenFiles,
  buildWebScaffoldPlan,
  convertFilesToJavaScript,
  ignoreWebBuildOutput,
  managedReadme,
  mergeDependencies,
  patchAppEntry,
  patchMetroConfigForLocalPackages,
  removeTypeScriptScaffolding,
  resolveLocalPackageDir,
  writeAppConfig,
  writeGeneratedFiles,
  writeJestSetup,
  writePackageManagerOverrides,
  writeRuntimeConfig,
  addPackageJsonScripts,
} from '@armemon-library/cli-kit';
import {
  DEFAULT_LAYOUT,
  SHARED_DIR,
  managedPath,
  type AppLanguage,
  type AppLayout,
  type PackageManager,
  type Platform,
} from '@armemon-library/config-types';
import { sharedFolderReadme, sharedReadme } from '../../dist/index.js';

const CLI_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist');

const TEMPLATE: Record<string, string> = {
  'package.json': `${JSON.stringify(
    {
      name: 'MyApp',
      version: '0.0.1',
      private: true,
      scripts: {
        android: 'react-native run-android',
        ios: 'react-native run-ios',
        lint: 'eslint .',
        start: 'react-native start',
        test: 'jest',
      },
      dependencies: { react: '18.3.1', 'react-native': '0.76.0' },
      devDependencies: {
        '@babel/core': '^7.25.2',
        '@react-native/babel-preset': '0.76.0',
        '@react-native/eslint-config': '0.76.0',
        '@react-native/metro-config': '0.76.0',
        '@react-native/typescript-config': '0.76.0',
        '@types/react': '^18.2.6',
        '@types/react-test-renderer': '^18.0.0',
        jest: '^29.6.3',
        'react-test-renderer': '18.3.1',
        typescript: '5.0.4',
      },
      engines: { node: '>=18' },
    },
    null,
    2,
  )}\n`,
  'index.js': `/**
 * @format
 */

import {AppRegistry} from 'react-native';
import App from './App';
import {name as appName} from './app.json';

AppRegistry.registerComponent(appName, () => App);
`,
  'app.json': '{\n  "name": "MyApp",\n  "displayName": "MyApp"\n}\n',
  'tsconfig.json': '{\n  "extends": "@react-native/typescript-config/tsconfig.json"\n}\n',
  'babel.config.js': "module.exports = {\n  presets: ['module:@react-native/babel-preset'],\n};\n",
  '.prettierrc.js': "module.exports = {\n  arrowParens: 'avoid',\n  bracketSameLine: true,\n  bracketSpacing: false,\n  singleQuote: true,\n  trailingComma: 'all',\n};\n",
  '.eslintrc.js': "module.exports = {\n  root: true,\n  extends: '@react-native',\n};\n",
  '.gitignore': '# OSX\n.DS_Store\n\nnode_modules/\n',
  'jest.config.js': "module.exports = {\n  preset: 'react-native',\n};\n",
  'App.tsx': 'export default function App() {\n  return null;\n}\n',
};

export interface PluginApp {
  root: string;
  language: AppLanguage;
  read(relative: string): Promise<string>;
  write(relative: string, content: string): Promise<void>;
  exists(relative: string): Promise<boolean>;
  /** Every file in the app with its content — to prove a run changed nothing, or what it changed. */
  snapshot(): Promise<Record<string, string>>;
  remove(): Promise<void>;
}

/** What `armemon init react-native MyApp --plugins ""` leaves, minus the native folders. */
export async function makePluginApp(
  options: { language?: AppLanguage; platforms?: Platform[]; packageManager?: PackageManager; layout?: AppLayout } = {},
): Promise<PluginApp> {
  const language = options.language ?? 'typescript';
  const platforms = options.platforms ?? ['ios', 'android', 'web'];
  const packageManager = options.packageManager ?? 'npm';
  // An app from before the managed zone moved to the root keeps it at src/armemon/.
  const layout = options.layout ?? DEFAULT_LAYOUT;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'armemon-plugins-'));
  const write = async (relative: string, content: string) => {
    const target = path.join(root, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf8');
  };
  for (const [relative, content] of Object.entries(TEMPLATE)) await write(relative, content);

  if (language === 'javascript') await removeTypeScriptScaffolding(root);

  const writeFiles = async (files: Array<{ path: string; content: string }>) => {
    const converted = language === 'javascript' ? (await convertFilesToJavaScript(files)).files : files;
    await writeGeneratedFiles(root, converted, { layout });
  };

  const fromCli = { resolveFrom: [CLI_DIST] };
  const dedupe = ['react', 'react-dom', 'react-native', 'react-native-web'];
  const web = platforms.includes('web') ? buildWebScaffoldPlan('18.3.1', dedupe) : undefined;

  await writeAppConfig(root, { appName: 'MyApp', rnVersion: '0.76.0', platforms, packageManager, language, plugins: {} });

  if (web) {
    const viteConfig = `web/vite.config.${language === 'javascript' ? 'js' : 'ts'}`;
    await addPackageJsonScripts(root, { web: `vite --config ${viteConfig}`, 'web:build': `vite build --config ${viteConfig}` });
  }
  const dependencies = {
    ...(web?.npmDependencies ?? {}),
    '@armemon-library/core': buildArmemonDependencySpecifier('@armemon-library/core', fromCli),
  };
  await mergeDependencies(root, dependencies, {
    '@armemon-library/config-types': buildArmemonDependencySpecifier('@armemon-library/config-types', fromCli),
    ...(language === 'javascript' ? {} : { '@types/jest': '^29.5.14' }),
  });
  await writePackageManagerOverrides(
    root,
    packageManager,
    Object.fromEntries(
      ['@armemon-library/core', '@armemon-library/cli-kit', '@armemon-library/config-types'].map((name) => [
        name,
        buildArmemonDependencySpecifier(name, fromCli),
      ]),
    ),
  );
  if (web) await appendGitignoreEntries(root, ['web/dist/']);
  await patchMetroConfigForLocalPackages(
    root,
    ['@armemon-library/core', '@armemon-library/config-types'].map((name) => resolveLocalPackageDir(name, fromCli)),
  );

  if (web) {
    await writeFiles(web.filesToWrite);
    await ignoreWebBuildOutput(root);
  }
  await writeRuntimeConfig(root, { orderedPlugins: [], contributions: {}, language, layout });
  await writeFiles(buildScreenFiles({ routeName: 'Welcome', shape: 'flat', language, kind: 'welcome', appName: 'MyApp', layout }));
  const extension = language === 'javascript' ? 'js' : 'ts';
  await writeFiles([
    ...buildScreenFiles({ routeName: 'Example', shape: 'full', language, kind: 'reference', layout }),
    { path: `${SHARED_DIR}/README.md`, content: sharedReadme() },
    { path: `${SHARED_DIR}/components/README.md`, content: sharedFolderReadme('components', extension) },
  ]);
  await writeFiles([{ path: managedPath(layout, 'README.md'), content: managedReadme(layout, { plugins: [], language }) }]);
  await patchAppEntry({ appRoot: root, root: 'welcome', language, layout });
  await writeJestSetup(root, Object.keys(dependencies), [], language, true);

  const snapshot = async (dir = root, prefix = ''): Promise<Record<string, string>> => {
    const out: Record<string, string> = {};
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      const key = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) Object.assign(out, await snapshot(full, key));
      else out[key] = await fs.readFile(full, 'utf8');
    }
    return out;
  };

  return {
    root,
    language,
    read: (relative) => fs.readFile(path.join(root, relative), 'utf8'),
    write,
    exists: (relative) => fs.access(path.join(root, relative)).then(() => true, () => false),
    snapshot: () => snapshot(),
    remove: () => fs.rm(root, { recursive: true, force: true }),
  };
}

/**
 * Puts stand-ins for `npm`, `pnpm` and `yarn` first on PATH. Each sleeps FAKE_NPM_SLEEP
 * seconds (0 by default), exits with FAKE_NPM_EXIT (0 by default) and, like a real
 * install, rewrites its lockfile — so a test can see the lockfile put back when the
 * install fails or is interrupted.
 */
export async function useFakeNpm(): Promise<{ bin: string; restore(): Promise<void> }> {
  const bin = await fs.mkdtemp(path.join(os.tmpdir(), 'armemon-fake-npm-'));
  const lockfiles: Record<string, string> = { npm: 'package-lock.json', pnpm: 'pnpm-lock.yaml', yarn: 'yarn.lock' };
  for (const [manager, lockfile] of Object.entries(lockfiles)) {
    await fs.writeFile(
      path.join(bin, manager),
      `#!/bin/sh\nsleep \${FAKE_NPM_SLEEP:-0}\necho 'written by the fake ${manager}' > ${lockfile}\nexit \${FAKE_NPM_EXIT:-0}\n`,
      { mode: 0o755 },
    );
  }
  const previous = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previous ?? ''}`;
  return {
    bin,
    restore: async () => {
      process.env.PATH = previous;
      delete process.env.FAKE_NPM_EXIT;
      delete process.env.FAKE_NPM_SLEEP;
      await fs.rm(bin, { recursive: true, force: true });
    },
  };
}

/** package.json with every object's keys sorted, since npm sorts dependencies on install anyway. */
export function normalizedPackageJson(text: string): string {
  const sort = (value: unknown): unknown =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, sort(entry)]))
      : value;
  return JSON.stringify(sort(JSON.parse(text)), null, 2);
}
