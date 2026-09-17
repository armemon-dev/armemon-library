/**
 * Regression tests for the CLI toolkit. Each case maps to a shipped defect: a
 * dependency label that claimed verification nobody had done, a Babel config that
 * clobbered itself, a dependency merge that hid conflicts, codegen that discarded
 * wizard answers, and a preflight that never ran.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {
  appConfigFileName,
  serializeAppConfig,
  readAppConfig,
  findAppConfigFile,
  buildPlatformGuide,
  removePackageJsonDependencies,
  applyHtmlContributions,
  renderTemplate,
  rnMinorKey,
  resolveKnownGoodSet,
  verifiedRnMinors,
  buildBabelConfigSource,
  orderBabelPlugins,
  collectDependencies,
  generateRuntimeConfigSource,
  generateUserRuntimeConfigSource,
  sortPluginsByDependencies,
  filterPluginsByPlatform,
  buildJestSetupSource,
  buildJestConfigSource,
  writeJestSetup,
  appendGitignoreEntries,
  prependToAppIndex,
  mergeDependencies,
  patchAppEntry,
  assertTargetDirectoryUsable,
  isCliError,
  buildWebScaffoldPlan,
  installDependencies,
  withOutputStep,
  isSupportedNodeVersion,
  MIN_NODE_VERSION,
  ignoreWebBuildOutput,
  removeTypeScriptScaffolding,
} from '../dist/index.js';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'armemon-test-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('renderTemplate', () => {
  it('substitutes tokens', () => {
    expect(renderTemplate('a {{x}} b', { x: 'Q' })).toBe('a Q b');
  });
  it('throws loudly on an unknown token rather than substituting empty', () => {
    expect(() => renderTemplate('{{nope}}', {})).toThrow(/unknown token/);
  });
  it('allows an intentionally empty token', () => {
    expect(renderTemplate('[{{x}}]', { x: '' })).toBe('[]');
  });
});

describe('known-good version matrix', () => {
  it('normalises a patch version to its minor key', () => {
    expect(rnMinorKey('0.76.3')).toBe('0.76');
    expect(rnMinorKey('latest')).toBeNull();
  });

  it("returns null for a minor nobody verified, instead of another minor's pins", () => {
    // The whole point: the old flat map served RN 0.76 pins under a label that
    // claimed they were verified against whatever version the user typed.
    expect(resolveKnownGoodSet('0.72.0')).toBeNull();
    expect(resolveKnownGoodSet('0.81.0')).toBeNull();
  });

  it('returns the verified set for a minor it does cover', () => {
    const set = resolveKnownGoodSet('0.76.0');
    expect(set?.['react-native-screens']).toBe('4.5.0');
  });

  it('exact-pins every package with native view-config codegen', () => {
    const set = resolveKnownGoodSet('0.76.0')!;
    for (const name of [
      'react-native-screens',
      'react-native-safe-area-context',
      'react-native-gesture-handler',
      'react-native-reanimated',
      'react-native-bootsplash',
    ]) {
      expect(set[name], `${name} must be exact-pinned, not caret-ranged`).toMatch(
        /^\d+\.\d+\.\d+$/,
      );
    }
  });

  it('reports which minors are verified', () => {
    expect(verifiedRnMinors()).toContain('0.76');
  });
});

describe('babel config composition', () => {
  it('keeps reanimated last however it was ordered', () => {
    const ordered = orderBabelPlugins([
      "'react-native-reanimated/plugin'",
      "['module-resolver', {}]",
    ]);
    expect(ordered[ordered.length - 1]).toContain('reanimated');
  });

  it('merges every plugin into one config instead of overwriting', () => {
    const source = buildBabelConfigSource(
      "module.exports = {\n  presets: ['module:@react-native/babel-preset'],\n};\n",
      ["['module:react-native-dotenv', {}]", "['module-resolver', {}]"],
    );
    expect(source).toContain('module:react-native-dotenv');
    expect(source).toContain('module-resolver');
    expect(source).toContain('module:@react-native/babel-preset');
  });

  it("preserves an unrecognised config's presets rather than dropping them", () => {
    const source = buildBabelConfigSource(
      "module.exports = { presets: ['custom-preset', 'another'] };",
      ["['x']"],
    );
    expect(source).toContain('custom-preset');
    expect(source).toContain('another');
  });

  it('de-duplicates repeated entries', () => {
    const source = buildBabelConfigSource(null, ["['a']", "['a']"]);
    expect(source.match(/\['a'\]/g)).toHaveLength(1);
  });
});

describe('collectDependencies', () => {
  it('reports a conflict instead of resolving it silently', () => {
    const result = collectDependencies([
      { source: 'redux', dependencies: { 'react-native-screens': '4.5.0' } },
      { source: 'navigation', dependencies: { 'react-native-screens': 'latest' } },
    ]);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]!.packageName).toBe('react-native-screens');
    expect(result.conflicts[0]!.resolved).toBe('latest');
    expect(result.conflicts[0]!.requests.map((r) => r.source)).toEqual(['redux', 'navigation']);
  });

  it('does not flag agreement as a conflict', () => {
    const result = collectDependencies([
      { source: 'a', dependencies: { x: '1.0.0' } },
      { source: 'b', dependencies: { x: '1.0.0' } },
    ]);
    expect(result.conflicts).toHaveLength(0);
  });

  it('keeps devDependencies in their own channel', () => {
    const result = collectDependencies([
      { source: 'advanced-init', devDependencies: { 'babel-plugin-module-resolver': '^5.0.2' } },
    ]);
    expect(result.dependencies).toEqual({});
    expect(result.devDependencies['babel-plugin-module-resolver']).toBe('^5.0.2');
  });
});

describe('runtime config codegen', () => {
  const plugins = [{ packageName: '@armemon-library/splash', runtimeExportName: 'SplashPlugin' }];

  it('emits wizard-decided runtime values instead of a fixed two-field object', () => {
    const source = generateRuntimeConfigSource({
      orderedPlugins: plugins,
      contributions: { minSplashDurationMs: 1500 },
    });
    expect(source).toContain('minSplashDurationMs: 1500');
  });

  it('omits a zero minimum duration rather than emitting a no-op field', () => {
    const source = generateRuntimeConfigSource({
      orderedPlugins: plugins,
      contributions: { minSplashDurationMs: 0 },
    });
    expect(source).not.toContain('minSplashDurationMs');
  });

  it('imports user tasks from the hand-editable sibling, not the generated file', () => {
    const source = generateRuntimeConfigSource({ orderedPlugins: plugins });
    expect(source).toContain("from './runtime.config'");
    expect(source).toContain('userTasks,');
    // Both hand-editable exports come from that sibling: the tasks, and the
    // overrides that let an app author reach the RuntimeConfig fields the wizard
    // set — without editing a file the next `armemon init` rewrites.
    expect(source).toContain('runtimeOverrides');
    expect(source.indexOf('...runtimeOverrides')).toBeGreaterThan(source.indexOf('userTasks,'));
  });

  it('emits component overrides as imports', () => {
    const source = generateRuntimeConfigSource({
      orderedPlugins: plugins,
      contributions: { splashScreenComponent: { importName: 'MySplash', from: './splash' } },
    });
    expect(source).toContain("import { MySplash as SplashScreenComponent } from './splash';");
    expect(source).toContain('SplashScreenComponent,');
  });

  it('gives the user task file a valid empty default', () => {
    // The pointer at the top of the generated file has to name a file that exists:
    // a JavaScript app has no runtime.config.ts to be sent to.
    expect(generateRuntimeConfigSource({ orderedPlugins: [], language: 'javascript' })).toContain(
      './runtime.config.js',
    );
    expect(generateRuntimeConfigSource({ orderedPlugins: [] })).toContain('./runtime.config.ts');

    expect(generateUserRuntimeConfigSource()).toContain('export const userTasks');
    // The second export is what makes SplashScreenComponent, ErrorScreenComponent,
    // readyCustom, readyCustomTimeout and minSplashDurationMs settable at all from
    // a file armemon won't overwrite.
    for (const language of ['typescript', 'javascript'] as const) {
      const source = generateUserRuntimeConfigSource(language);
      expect(source, language).toContain('export const runtimeOverrides');
      for (const field of [
        'SplashScreenComponent',
        'ErrorScreenComponent',
        'minSplashDurationMs',
        'readyCustom',
        'readyCustomTimeout',
      ]) {
        expect(source, `${language} runtime.config never mentions ${field}`).toContain(field);
      }
    }
  });
});

describe('plugin ordering and platform filtering', () => {
  const plugin = (id: string, extra: Record<string, unknown> = {}) => ({
    packageName: `@armemon-library/${id}`,
    manifest: {
      manifestVersion: 1 as const,
      pluginId: id,
      displayName: id,
      description: id,
      runtimeExportName: 'X',
      ...extra,
    },
  });

  it('runs a dependency before its dependent regardless of input order', () => {
    const sorted = sortPluginsByDependencies([
      plugin('navigation', { dependsOn: ['redux'] }),
      plugin('redux'),
    ] as never);
    expect(sorted.map((p) => p.manifest.pluginId)).toEqual(['redux', 'navigation']);
  });

  it('ignores a dependency the user did not select', () => {
    const sorted = sortPluginsByDependencies([
      plugin('navigation', { dependsOn: ['redux'] }),
    ] as never);
    expect(sorted.map((p) => p.manifest.pluginId)).toEqual(['navigation']);
  });

  it('throws on a declared cycle', () => {
    expect(() =>
      sortPluginsByDependencies([
        plugin('a', { dependsOn: ['b'] }),
        plugin('b', { dependsOn: ['a'] }),
      ] as never),
    ).toThrow(/Circular plugin dependency/);
  });

  it('hides a native-only plugin from a web-only app', () => {
    const filtered = filterPluginsByPlatform(
      [plugin('splash', { platforms: ['ios', 'android'] }), plugin('ui')] as never,
      ['web'],
    );
    expect(filtered.map((p) => p.manifest.pluginId)).toEqual(['ui']);
  });

  it('keeps a native-only plugin when any of its platforms is selected', () => {
    const filtered = filterPluginsByPlatform(
      [plugin('splash', { platforms: ['ios', 'android'] })] as never,
      ['web', 'android'],
    );
    expect(filtered).toHaveLength(1);
  });
});

describe('jest setup generation', () => {
  it('mocks only the native modules that were actually installed', () => {
    const source = buildJestSetupSource(['react-native-bootsplash']);
    expect(source).toContain('react-native-bootsplash');
    expect(source).not.toContain('netinfo');
  });

  it('produces a valid file when nothing needed mocking', () => {
    expect(buildJestSetupSource(['react'])).toContain('No native modules');
  });

  // jest.resolver.js exists for file: links alone. It used to be written into every
  // app, including ones installed from npm, with a comment telling the reader to
  // delete it "once the packages are installed from the registry".
  describe.each(['typescript', 'javascript'] as const)('in a %s app', (language) => {
    it('points jest at the resolver only when the packages are linked by path', () => {
      expect(buildJestConfigSource(null, 'react-native', language, true)).toContain(
        "resolver: '<rootDir>/jest.resolver.js'",
      );
      const installed = buildJestConfigSource(null, 'react-native', language, false);
      expect(installed).not.toContain('resolver');
      expect(installed).toContain("setupFiles");
    });

    it('writes jest.resolver.js only when the packages are linked by path', async () => {
      await writeJestSetup(tmp, ['react'], [], language, false);
      await expect(fs.access(path.join(tmp, 'jest.resolver.js'))).rejects.toThrow();
      expect(await fs.readFile(path.join(tmp, 'jest.config.js'), 'utf8')).not.toContain('resolver');

      await fs.rm(path.join(tmp, 'jest.config.js'));
      await writeJestSetup(tmp, ['react'], [], language, true);
      await expect(fs.access(path.join(tmp, 'jest.resolver.js'))).resolves.toBeUndefined();
    });
  });
});

describe('filesystem patchers', () => {
  it('adds .env to .gitignore and stays idempotent', async () => {
    await fs.writeFile(path.join(tmp, '.gitignore'), 'node_modules/\n');
    await appendGitignoreEntries(tmp, ['.env']);
    await appendGitignoreEntries(tmp, ['.env']);
    const content = await fs.readFile(path.join(tmp, '.gitignore'), 'utf8');
    expect(content.match(/^\.env$/gm)).toHaveLength(1);
  });

  it('puts the gesture-handler import on the very first line of index.js', async () => {
    await fs.writeFile(path.join(tmp, 'index.js'), "import {AppRegistry} from 'react-native';\n");
    await prependToAppIndex(tmp, ["import 'react-native-gesture-handler';"]);
    const content = await fs.readFile(path.join(tmp, 'index.js'), 'utf8');
    expect(content.split('\n')[0]).toBe("import 'react-native-gesture-handler';");
    expect(content).toContain('AppRegistry');
  });

  it('does not duplicate an entry prelude on a second run', async () => {
    await fs.writeFile(path.join(tmp, 'index.js'), "import 'react-native-gesture-handler';\n");
    await prependToAppIndex(tmp, ["import 'react-native-gesture-handler';"]);
    const content = await fs.readFile(path.join(tmp, 'index.js'), 'utf8');
    expect(content.match(/gesture-handler/g)).toHaveLength(1);
  });

  it('writes devDependencies to devDependencies, not dependencies', async () => {
    await fs.writeFile(path.join(tmp, 'package.json'), JSON.stringify({ name: 'x' }));
    await mergeDependencies(tmp, { react: '18.3.1' }, { 'babel-plugin-module-resolver': '^5.0.2' });
    const pkg = JSON.parse(await fs.readFile(path.join(tmp, 'package.json'), 'utf8'));
    expect(pkg.dependencies).toEqual({ react: '18.3.1' });
    expect(pkg.devDependencies).toEqual({ 'babel-plugin-module-resolver': '^5.0.2' });
  });

  it('renders the welcome screen as the root when there is no navigator', async () => {
    // Not the UI catalogue: that lives in src/armemon-examples/, which the user is
    // told to delete, and an app root you cannot delete is a contradiction.
    await patchAppEntry({ appRoot: tmp, root: 'welcome' });
    const content = await fs.readFile(path.join(tmp, 'App.tsx'), 'utf8');
    expect(content).toContain("from './src/screens/WelcomeScreen'");
    // The folder is named in the "where things live" table, which is fine; what it
    // must never be is something App depends on.
    expect(content).not.toMatch(/^import .*armemon-examples/m);
    expect(content).toContain('runtime.generated');
    expect(content).toContain('KitProvider');
  });

  it('prefers the navigator over the example screen', async () => {
    await patchAppEntry({ appRoot: tmp, root: 'navigation' });
    const content = await fs.readFile(path.join(tmp, 'App.tsx'), 'utf8');
    expect(content).toContain('RootNavigator');
  });
});

describe('preflight', () => {
  it('accepts a directory that does not exist yet', async () => {
    await expect(assertTargetDirectoryUsable(path.join(tmp, 'fresh'))).resolves.toBe(false);
  });

  it('accepts an existing but empty directory', async () => {
    const dir = path.join(tmp, 'empty');
    await fs.mkdir(dir);
    await expect(assertTargetDirectoryUsable(dir)).resolves.toBe(true);
  });

  it('refuses a non-empty directory with an actionable message', async () => {
    const dir = path.join(tmp, 'busy');
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, 'file.txt'), 'x');
    await expect(assertTargetDirectoryUsable(dir)).rejects.toSatisfy(
      (error: unknown) => isCliError(error) && /isn't empty/.test((error as Error).message),
    );
  });

  it('refuses a path occupied by a file', async () => {
    const target = path.join(tmp, 'afile');
    await fs.writeFile(target, 'x');
    await expect(assertTargetDirectoryUsable(target)).rejects.toThrow(/is a file, not a directory/);
  });
});

describe('generated app config', () => {
  it('serialises to a typed module', () => {
    const source = serializeAppConfig({
      appName: 'X',
      rnVersion: '0.76.0',
      platforms: ['ios'],
      packageManager: 'npm',
      plugins: {},
    });
    expect(source).toContain('ArmemonAppConfig');
    expect(source).toContain('"appName": "X"');
  });
});

describe('web scaffold', () => {
  const plan = buildWebScaffoldPlan('18.3.1');
  const entry = plan.filesToWrite.find((f) => f.path === 'web/index.tsx')!;

  it("pins react-dom to the app's exact react version", () => {
    expect(plan.npmDependencies['react-dom']).toBe('18.3.1');
  });

  it('passes initialProps, which AppParameters requires', () => {
    expect(entry.content).toContain('initialProps: {}');
  });

  it('declares `document` locally, since the RN tsconfig has no DOM lib', () => {
    expect(entry.content).toContain('declare const document');
  });

  it('fails loudly if the mount point is missing rather than passing null', () => {
    expect(entry.content).toContain('missing its <div id="root">');
  });

  it('casts the DOM mount point, which RN 0.87 typings reject', () => {
    // RootTag narrowed to `number | symbol`; react-native-web really does take an
    // element. Without the cast, tsc fails on every RN >= 0.87 web scaffold.
    expect(entry.content).toContain('rootTag: rootTag as unknown as RootTagType');
    expect(entry.content).toContain('Parameters<typeof AppRegistry.runApplication>');
  });

  it('uses an exact-match alias so deep react-native imports still resolve', () => {
    const vite = plan.filesToWrite.find((f) => f.path === 'web/vite.config.ts')!;
    expect(vite.content).toContain('/^react-native$/');
    expect(vite.content).toContain("require.resolve('react-native-web')");
  });
});

describe('--all-accept validates its own defaults', () => {
  // Auto-accept used to return a default without running the validator, so a plugin
  // with a bad default silently generated broken output in exactly the mode where
  // nobody is watching the prompts go by.
  it("rejects a default that fails the prompt's own validator", async () => {
    const { setAutoAccept, promptText } = await import('../dist/index.js');
    setAutoAccept(true);
    try {
      await expect(
        promptText({
          message: 'Screen name?',
          defaultValue: 'not a valid name',
          validate: (value) => (/^[A-Z][A-Za-z0-9]*$/.test(value) ? undefined : 'bad'),
        }),
      ).rejects.toThrow(/default for .* is itself invalid/);
    } finally {
      setAutoAccept(false);
    }
  });

  it('rejects a select whose initialValue is not one of its options', async () => {
    const { setAutoAccept, promptSelect } = await import('../dist/index.js');
    setAutoAccept(true);
    try {
      await expect(
        promptSelect({
          message: 'Mode?',
          options: [{ value: 'a', label: 'A' }],
          initialValue: 'z' as 'a',
        }),
      ).rejects.toThrow(/isn't one of its options/);
    } finally {
      setAutoAccept(false);
    }
  });

  it('still returns a valid default untouched', async () => {
    const { setAutoAccept, promptText } = await import('../dist/index.js');
    setAutoAccept(true);
    try {
      await expect(
        promptText({ message: 'Name?', defaultValue: 'Home', validate: () => undefined }),
      ).resolves.toBe('Home');
    } finally {
      setAutoAccept(false);
    }
  });
});

describe('the web target is a folder of its own, like android/ and ios/', () => {
  const plan = buildWebScaffoldPlan('18.3.1');
  const paths = plan.filesToWrite.map((f) => f.path);

  it('keeps every web file under web/ instead of the app root', () => {
    // The app root previously collected index.html, index.web.tsx and
    // vite.config.ts while `web/` held nothing but build output — confusing next
    // to android/ and ios/, which are real project folders.
    expect(paths).toContain('web/vite.config.ts');
    expect(paths).toContain('web/index.html');
    expect(paths).toContain('web/index.tsx');
    for (const p of paths) expect(p.startsWith('web/'), p).toBe(true);
  });

  // Everything in web/public is copied into dist/ and deployed, so a note placed
  // there was served from the live site at /README.md.
  it('puts nothing in web/public that would be deployed', () => {
    expect(paths.filter((p) => p.startsWith('web/public/'))).toEqual([]);
  });

  it('points index.html at the entry inside the same folder', () => {
    const html = plan.filesToWrite.find((f) => f.path === 'web/index.html')!;
    expect(html.content).toContain('src="/index.tsx"');
  });

  it('lets Vite reach App.tsx and src/, which sit above its root', () => {
    const vite = plan.filesToWrite.find((f) => f.path === 'web/vite.config.ts')!;
    expect(vite.content).toContain('fs: { allow: [appRoot] }');
  });
});

describe("web target tracks the app's React major", () => {
  // react-native-web 0.19 peers on react@^18 only. React Native 0.87 installs
  // React 19, so a hardcoded 0.19 pin made `--platforms web` fail npm's ERESOLVE
  // check before writing a file.
  it('uses a React 19-compatible react-native-web when the app is on React 19', () => {
    expect(buildWebScaffoldPlan('19.2.3').npmDependencies['react-native-web']).toBe('^0.20.0');
  });

  it('keeps the proven 0.19 line on React 18', () => {
    expect(buildWebScaffoldPlan('18.3.1').npmDependencies['react-native-web']).toBe('^0.19.13');
  });

  it('takes the broader peer range when the React version is not a number', () => {
    expect(buildWebScaffoldPlan('latest').npmDependencies['react-native-web']).toBe('^0.20.0');
  });
});

describe('applyHtmlContributions', () => {
  const page = [
    '<!doctype html>',
    '<html>',
    '  <head>',
    '    <title>App</title>',
    '  </head>',
    '  <body>',
    '    <div id="root"></div>',
    '  </body>',
    '</html>',
    '',
  ].join('\n');

  // index.html is the first file a web developer opens in a scaffolded app, and the
  // splash markup armemon injects is the first thing they see in it.
  it('lands a multi-line block at one consistent depth', () => {
    const style = ['<style>', '      #splash { inset: 0; }', '    </style>'].join('\n');
    const lines = applyHtmlContributions(page, [{ head: [style] }]).split('\n');

    expect(lines).toContain('    <style>');
    expect(lines).toContain('      #splash { inset: 0; }');
    expect(lines).toContain('    </style>');
    // The closing tag keeps its own indentation, and nothing rides along with it.
    expect(lines).toContain('  </head>');
  });

  it('puts body contributions before the app root, still indented', () => {
    const html = applyHtmlContributions(page, [{ bodyStart: ['<div id="splash"></div>'] }]);
    const lines = html.split('\n');
    expect(lines).toContain('    <div id="splash"></div>');
    expect(lines.indexOf('    <div id="splash"></div>')).toBeLessThan(
      lines.indexOf('    <div id="root"></div>'),
    );
  });

  it('still produces something usable when the document has no head', () => {
    const html = applyHtmlContributions('<div id="root"></div>\n', [{ head: ['<style></style>'] }]);
    expect(html).toContain('<style></style>');
    expect(html).toContain('<div id="root"></div>');
  });
});

describe('removePackageJsonDependencies', () => {
  // A platform whose attach step fails loses its config entry and its script. Its
  // dependency used to stay: an app with no windows/ folder still shipped
  // react-native-windows to everyone who installed it.
  const withPackageJson = async (
    contents: Record<string, unknown>,
    run: (dir: string) => Promise<void>,
  ): Promise<Record<string, Record<string, string>>> => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'armemon-pkg-'));
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify(contents, null, 2), 'utf8');
    await run(dir);
    const written = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'));
    await fs.rm(dir, { recursive: true, force: true });
    return written;
  };

  it('drops the named packages from both dependency fields', async () => {
    const pkg = await withPackageJson(
      {
        name: 'app',
        dependencies: { react: '18.3.1', 'react-native-windows': 'latest' },
        devDependencies: { typescript: '5.0.0', 'react-native-macos': '0.81.0' },
      },
      (dir) => removePackageJsonDependencies(dir, ['react-native-windows', 'react-native-macos']),
    );

    expect(pkg.dependencies).toEqual({ react: '18.3.1' });
    expect(pkg.devDependencies).toEqual({ typescript: '5.0.0' });
  });

  it('leaves a package.json without those fields alone', async () => {
    const pkg = await withPackageJson({ name: 'app' }, (dir) =>
      removePackageJsonDependencies(dir, ['react-native-windows']),
    );
    expect(pkg.name).toBe('app');
  });
});

describe('readAppConfig', () => {
  // armemon.config's whole point is being read back by later commands. `add` and
  // `doctor` both depend on getting the real object out of a source file that
  // cannot be imported: a .ts file node won't load, a .js one would run app code.
  const inApp = async (
    fileName: string,
    contents: string,
    run: (dir: string) => Promise<unknown>,
  ): Promise<unknown> => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'armemon-cfg-'));
    await fs.writeFile(path.join(dir, fileName), contents, 'utf8');
    try {
      return await run(dir);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  };

  const config = {
    appName: 'Demo',
    rnVersion: 'latest',
    platforms: ['ios', 'android'],
    packageManager: 'npm',
    language: 'typescript',
    plugins: { splash: { backgroundColor: '#fff' } },
  };

  it('reads the TypeScript spelling', async () => {
    const read = await inApp(
      'armemon.config.ts',
      `import type { ArmemonAppConfig } from '@armemon-library/config-types';\n\nconst config: ArmemonAppConfig = ${JSON.stringify(config, null, 2)};\n\nexport default config;\n`,
      (dir) => readAppConfig(dir),
    );
    expect(read).toEqual(config);
  });

  it('reads the JavaScript spelling', async () => {
    const read = await inApp(
      'armemon.config.js',
      `/** @type {import('@armemon-library/config-types').ArmemonAppConfig} */\nconst config = ${JSON.stringify(config)};\n\nexport default config;\n`,
      (dir) => readAppConfig(dir),
    );
    expect(read).toEqual(config);
  });

  it('survives the hand-edit armemon itself suggests', async () => {
    // "Add windows to the platforms array" — reformatted, reordered, still valid.
    const edited = { ...config, platforms: ['ios', 'android', 'windows'] };
    const read = (await inApp(
      'armemon.config.ts',
      `const config: ArmemonAppConfig = ${JSON.stringify(edited, null, 4)};\nexport default config;\n`,
      (dir) => readAppConfig(dir),
    )) as typeof edited;
    expect(read.platforms).toEqual(['ios', 'android', 'windows']);
  });

  it('is not fooled by a brace inside a string', async () => {
    const withBrace = { ...config, appName: 'De}mo' };
    const read = await inApp(
      'armemon.config.ts',
      `const config: ArmemonAppConfig = ${JSON.stringify(withBrace, null, 2)};\nexport default config;\n`,
      (dir) => readAppConfig(dir),
    );
    expect(read).toEqual(withBrace);
  });

  // Parsing isn't the same as being right: "andriod" was accepted, and every command
  // after it worked from a config describing a different app.
  it('names every field that is wrong, at once', async () => {
    const broken = { ...config, platforms: ['ios', 'andriod'], packageManager: 'npx', language: 'ts' };
    await expect(
      inApp('armemon.config.ts', `const config = ${JSON.stringify(broken)};\nexport default config;\n`, (dir) =>
        readAppConfig(dir),
      ),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/armemon\.config\.ts has 3 problems: .*"andriod".*"packageManager".*"language"/),
    });
  });

  it('fills in the fields older apps predate instead of refusing them', async () => {
    const old: Record<string, unknown> = { ...config };
    delete old.language;
    delete old.plugins;
    const read = (await inApp(
      'armemon.config.ts',
      `const config = ${JSON.stringify(old)};\nexport default config;\n`,
      (dir) => readAppConfig(dir),
    )) as typeof config;
    expect(read.language).toBe('typescript');
    expect(read.plugins).toEqual({});
  });

  it('says which file to fix rather than surfacing a SyntaxError', async () => {
    await expect(
      inApp('armemon.config.ts', 'const config = { appName: Demo };\n', (dir) =>
        readAppConfig(dir),
      ),
    ).rejects.toThrow(/armemon\.config\.ts/);
  });

  it('reports a directory that was never scaffolded', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'armemon-cfg-'));
    expect(await findAppConfigFile(dir)).toBeNull();
    await expect(readAppConfig(dir)).rejects.toThrow(/No armemon\.config/);
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe('buildPlatformGuide', () => {
  // The placeholder README is the only thing standing between a missing folder and
  // someone concluding the platform isn't supported.
  const guide = buildPlatformGuide({
    platform: 'windows',
    appName: 'Demo',
    rnVersion: '0.87.1',
    packageManager: 'pnpm',
    scaffoldedOn: 'linux',
  });

  it('names the one command that finishes the job', () => {
    expect(guide).toContain('@armemon-library/cli add windows');
  });

  it('uses the app own package manager, not a generic npm line', () => {
    expect(guide).toContain('pnpm install');
    expect(guide).toContain('pnpm dlx @armemon-library/cli add windows');
  });

  // The app doesn't depend on the CLI, so the command has to fetch it by its real
  // package name. A bare `armemon` asks npm for a package that isn't ours, and each
  // manager spells "run a package I don't have" differently (`bun dlx` isn't one).
  it.each([
    ['npm', 'npx @armemon-library/cli add windows'],
    ['yarn', 'npx @armemon-library/cli add windows'],
    ['pnpm', 'pnpm dlx @armemon-library/cli add windows'],
    ['bun', 'bunx @armemon-library/cli add windows'],
  ])('with %s, runs the CLI by its package name: %s', (packageManager, command) => {
    const text = buildPlatformGuide({
      platform: 'windows',
      appName: 'Demo',
      rnVersion: '0.87.1',
      packageManager,
      scaffoldedOn: 'linux',
    });
    expect(text).toContain(`\n${command}\n`);
    expect(text).not.toMatch(/(?:npx|dlx|bunx|yarn) armemon\b/);
  });

  it('says why, so it does not read as unsupported', () => {
    expect(guide).toContain('pwsh.exe');
    expect(guide).toContain('not of armemon');
  });

  it('carries the app real React Native version', () => {
    expect(guide).toContain('0.87.1');
  });

  it('never prints "latest" as the version it just told you not to trust', () => {
    // The guide explains that the pairing is resolved against what the app really
    // runs. Printing `latest` there as the app's version contradicts the sentence
    // it sits in.
    expect(guide).not.toMatch(/version — `latest`/);
    expect(guide).not.toMatch(/version \(`latest`\)/);
  });

  it('states the trade-offs rather than only the steps', () => {
    expect(guide).toMatch(/autolinking/);
    expect(guide).toMatch(/every teammate an install/i);
  });
});

describe('serializeAppConfig', () => {
  const config = {
    appName: 'Demo',
    rnVersion: '0.76.0',
    platforms: ['ios'],
    packageManager: 'npm',
    language: 'typescript' as const,
    plugins: {},
  };

  // The generated config lives in the USER's app, where the CLI's own module graph
  // does not exist. An edit to this file once added `import { CliError } from
  // '../errors.js'` to the template as well as to the module, and every scaffolded
  // app failed type-check on line 2.
  it('imports nothing but the type, and nothing by relative path', () => {
    const source = serializeAppConfig(config);
    const imports = source.split('\n').filter((line) => line.startsWith('import'));

    expect(imports).toEqual([
      "import type { ArmemonAppConfig } from '@armemon-library/config-types';",
    ]);
    expect(source).not.toMatch(/from '\.\.?\//);
  });

  it('emits no import at all for a JavaScript app', () => {
    const source = serializeAppConfig({ ...config, language: 'javascript' });
    expect(source.split('\n').filter((line) => line.startsWith('import'))).toEqual([]);
    expect(source).not.toMatch(/from '\.\.?\//);
  });

  it('round-trips through readAppConfig in both languages', async () => {
    for (const language of ['typescript', 'javascript'] as const) {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'armemon-rt-'));
      const shaped = { ...config, language };
      await fs.writeFile(
        path.join(dir, appConfigFileName(shaped)),
        serializeAppConfig(shaped),
        'utf8',
      );
      expect(await readAppConfig(dir)).toEqual(shaped);
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe.skipIf(process.platform === 'win32')('installDependencies', () => {
  /** A stand-in package manager that records each run, then fails the way it's told to. */
  const fakeManager = async (behaviour: 'exit 1' | 'kill -INT $$') => {
    const script = path.join(tmp, 'fake-pm');
    await fs.writeFile(script, `#!/bin/sh\necho run >> "${path.join(tmp, 'runs')}"\n${behaviour}\n`, { mode: 0o755 });
    return script;
  };
  const runs = async () => (await fs.readFile(path.join(tmp, 'runs'), 'utf8')).trim().split('\n').length;

  it('retries an install that failed', async () => {
    const manager = await fakeManager('exit 1');
    await expect(installDependencies(tmp, manager as never, { retries: 1 })).rejects.toThrow();
    expect(await runs()).toBe(2);
  });

  // Ctrl-C reaches the package manager too. Retrying it started the whole install
  // again after the user had asked it to stop.
  it('does not retry an install that was stopped by a signal', async () => {
    const manager = await fakeManager('kill -INT $$');
    await expect(installDependencies(tmp, manager as never, { retries: 1 })).rejects.toThrow();
    expect(await runs()).toBe(1);
  });
});

describe('withOutputStep', () => {
  const plain = (line: string) => line.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '');

  // For a child process that prints to the terminal itself. An animated spinner on
  // top of npm's or CocoaPods' own output garbled both, so this never animates —
  // even on a real terminal, where withSpinner would.
  it('prints a plain line before and after, on an interactive terminal too', async () => {
    // Forced, so this holds under CI too, where nothing counts as interactive.
    const forced = process.env.ARMEMON_FORCE_INTERACTIVE;
    process.env.ARMEMON_FORCE_INTERACTIVE = '1';
    const logged: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((line: unknown) => void logged.push(String(line)));
    const write = vi.spyOn(process.stdout, 'write');
    try {
      await withOutputStep('Installing dependencies…', async () => 'done');
      expect(logged.map(plain)).toEqual(['➡ Installing dependencies…', '✔ Installing dependencies…']);
      // clack's spinner draws with process.stdout.write; nothing else here does.
      expect(write).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      write.mockRestore();
      if (forced === undefined) delete process.env.ARMEMON_FORCE_INTERACTIVE;
      else process.env.ARMEMON_FORCE_INTERACTIVE = forced;
    }
  });

  it('reports a failure and rethrows it', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await expect(
        withOutputStep('Installing…', async () => {
          throw new Error('npm ERR! boom');
        }),
      ).rejects.toThrow('npm ERR! boom');
      expect(plain(String(errors.mock.calls[0]?.[0]))).toContain('Installing… — failed');
    } finally {
      errors.mockRestore();
      log.mockRestore();
    }
  });
});

describe('the Node version floor', () => {
  it('compares full versions, not just the major', () => {
    expect(isSupportedNodeVersion('20.19.0')).toBe(true);
    expect(isSupportedNodeVersion('20.18.3')).toBe(false);
    expect(isSupportedNodeVersion('22.0.0')).toBe(true);
    expect(isSupportedNodeVersion('18.20.4')).toBe(false);
  });

  // Preflight and engines disagreed: one checked the major (18), the other said
  // 18.18, so Node 18.0–18.17 passed one and failed the other.
  it('is the same floor every package.json declares in engines', async () => {
    const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
    const manifests = [
      path.join(root, 'package.json'),
      ...(await fs.readdir(path.join(root, 'packages'))).map((dir) => path.join(root, 'packages', dir, 'package.json')),
    ];
    for (const manifest of manifests) {
      const pkg = JSON.parse(await fs.readFile(manifest, 'utf8')) as { engines?: { node?: string } };
      expect(pkg.engines?.node, manifest).toBe(`>=${MIN_NODE_VERSION}`);
    }
  });
});

describe.skipIf(process.platform === 'win32')('child process output under --json', () => {
  // npm's install summary and React Native's banner went to the CLI's own stdout, in
  // front of the JSON — so `armemon init --json | jq` failed on line one.
  it("sends a child's stdout to stderr once status lines go there", async () => {
    const manager = path.join(tmp, 'noisy-pm');
    await fs.writeFile(manager, '#!/bin/sh\necho "added 1149 packages"\n', { mode: 0o755 });
    const script = path.join(tmp, 'run.mjs');
    const kit = new URL('../dist/index.js', import.meta.url).href;
    await fs.writeFile(
      script,
      `import { installDependencies, setLogStream } from ${JSON.stringify(kit)};\n` +
        `setLogStream('stderr');\nawait installDependencies(${JSON.stringify(tmp)}, ${JSON.stringify(manager)});\n`,
    );

    const { spawnSync } = await import('node:child_process');
    const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('added 1149 packages');
  });

  it('leaves it on stdout otherwise', async () => {
    const manager = path.join(tmp, 'noisy-pm');
    await fs.writeFile(manager, '#!/bin/sh\necho "added 1149 packages"\n', { mode: 0o755 });
    const script = path.join(tmp, 'run.mjs');
    const kit = new URL('../dist/index.js', import.meta.url).href;
    await fs.writeFile(
      script,
      `import { installDependencies } from ${JSON.stringify(kit)};\nawait installDependencies(${JSON.stringify(tmp)}, ${JSON.stringify(manager)});\n`,
    );

    const { spawnSync } = await import('node:child_process');
    expect(spawnSync(process.execPath, [script], { encoding: 'utf8' }).stdout).toContain('added 1149 packages');
  });
});

describe('ignoreWebBuildOutput', () => {
  // After a web build, React Native's tsconfig (which checks JavaScript) read the
  // minified bundle: a function in it named `it` shadowed Jest's and failed tsc on
  // the app's own test, and `eslint .` reported tens of thousands of problems.
  it('adds web/dist to the exclude the tsconfig inherits, instead of replacing it', async () => {
    await fs.mkdir(path.join(tmp, 'node_modules/@react-native/typescript-config'), { recursive: true });
    await fs.writeFile(
      path.join(tmp, 'node_modules/@react-native/typescript-config/package.json'),
      JSON.stringify({ name: '@react-native/typescript-config' }),
    );
    await fs.writeFile(
      path.join(tmp, 'node_modules/@react-native/typescript-config/tsconfig.json'),
      '{\n  // comments, as the real one has\n  "compilerOptions": { "allowJs": true },\n  "exclude": ["**/Pods/**"]\n}\n',
    );
    await fs.writeFile(
      path.join(tmp, 'tsconfig.json'),
      JSON.stringify({ extends: '@react-native/typescript-config/tsconfig.json', compilerOptions: { paths: { '@/*': ['./src/*'] } } }),
    );

    await ignoreWebBuildOutput(tmp);
    await ignoreWebBuildOutput(tmp);

    const tsconfig = JSON.parse(await fs.readFile(path.join(tmp, 'tsconfig.json'), 'utf8'));
    expect(tsconfig.exclude).toEqual(['**/Pods/**', 'web/dist']);
    expect(tsconfig.compilerOptions.paths).toEqual({ '@/*': ['./src/*'] });
  });

  it('adds web/dist/ to .eslintignore once, for the legacy ESLint config the template uses', async () => {
    await fs.writeFile(path.join(tmp, '.eslintrc.js'), "module.exports = { root: true };\n");
    await fs.writeFile(path.join(tmp, '.eslintignore'), 'coverage/');

    await ignoreWebBuildOutput(tmp);
    await ignoreWebBuildOutput(tmp);

    expect(await fs.readFile(path.join(tmp, '.eslintignore'), 'utf8')).toBe('coverage/\nweb/dist/\n');
  });

  it('leaves a JavaScript app with no tsconfig, and a flat ESLint config, alone', async () => {
    await fs.writeFile(path.join(tmp, 'eslint.config.js'), 'export default [];\n');
    await ignoreWebBuildOutput(tmp);
    expect((await fs.readdir(tmp)).sort()).toEqual(['eslint.config.js']);
  });
});

describe('removeTypeScriptScaffolding', () => {
  // React Native's ESLint config needs `typescript` as a peer in a JavaScript app
  // too. Removed, npm installed the newest TypeScript to satisfy it, which the
  // template's @typescript-eslint couldn't load — `npm run lint` crashed.
  it("removes the type packages but keeps the template's pinned typescript", async () => {
    await fs.writeFile(
      path.join(tmp, 'package.json'),
      JSON.stringify({
        name: 'app',
        devDependencies: {
          typescript: '5.0.4',
          '@types/react': '^18.2.6',
          '@types/jest': '^29.5.13',
          '@react-native/typescript-config': '0.76.0',
          '@react-native/eslint-config': '0.76.0',
        },
      }),
    );
    await fs.writeFile(path.join(tmp, 'tsconfig.json'), '{}');

    const removed = await removeTypeScriptScaffolding(tmp);
    const pkg = JSON.parse(await fs.readFile(path.join(tmp, 'package.json'), 'utf8'));

    expect(pkg.devDependencies).toEqual({ typescript: '5.0.4', '@react-native/eslint-config': '0.76.0' });
    expect(removed.removedFiles).toContain('tsconfig.json');
  });
});

describe('lint-clean Jest files', () => {
  // `npm run lint` failed in brand-new apps on both files: jest.setup.js matches no
  // test pattern in React Native's ESLint config, and neither does App.test.jsx.
  it('declares the Jest environment where the template config does not', async () => {
    expect(buildJestSetupSource(['react']).startsWith('/* eslint-env jest */\n')).toBe(true);

    await writeJestSetup(tmp, ['react'], [], 'javascript', false);
    const test = await fs.readFile(path.join(tmp, '__tests__/App.test.jsx'), 'utf8');
    expect(test.startsWith('/* eslint-env jest */\n')).toBe(true);
  });
});
