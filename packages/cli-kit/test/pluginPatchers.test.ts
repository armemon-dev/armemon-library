/**
 * FILE: pluginPatchers.test.ts
 * PATH: packages/cli-kit/test/pluginPatchers.test.ts
 *
 * WHAT: The edits `armemon plugin add/remove` make to files an app shares with armemon —
 *       babel.config.js, index.js, runtime.generated, web/index.html, web/vite.config,
 *       jest.setup.js, jest.resolver.js, metro.config.js and the App entry.
 * WHY:  Each of these files is either still exactly what armemon generated, or someone
 *       has worked in it. The first case is covered by writing it again; these patchers
 *       are the second case, and the promise they make is strict: adding to a generated
 *       file gives what init would have generated, removing gives back the original
 *       bytes, running twice changes nothing, and a shape they don't understand is
 *       refused with the manual fix rather than guessed at. Every test below is one of
 *       those four promises, against the real generators' output.
 */
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import {
  addBabelPlugins,
  addEntryPrelude,
  addHtmlContributions,
  applyEdits,
  applyHtmlContributions,
  arrayElementInsertion,
  arrayElementRemoval,
  buildAppEntrySource,
  buildBabelConfigSource,
  buildJestResolverSource,
  buildJestSetupSource,
  buildMetroConfigSource,
  buildWebScaffoldPlan,
  convertFilesToJavaScript,
  generateRuntimeConfigSource,
  gitignoreWithEntries,
  mergeJsonValues,
  moduleReferences,
  packageNameOf,
  parseSource,
  patchJestResolverPins,
  patchJestSetup,
  patchMetroWatchFolders,
  patchRuntimeGenerated,
  patchViteConfig,
  readViteDedupe,
  removeBabelPlugins,
  removeEntryPrelude,
  removeHtmlContributions,
  sameCode,
  sourceSyntaxErrors,
  subtractJsonValues,
  swapAppEntryRoot,
  unmergeJsonValues,
  validateAppConfig,
} from '../dist/index.js';

const TEMPLATE_BABEL = "module.exports = {\n  presets: ['module:@react-native/babel-preset'],\n};\n";
const REANIMATED = "'react-native-reanimated/plugin'";
const RESOLVER = "['module-resolver', { root: ['./src'], alias: { '@': './src' } }]";
const DOTENV = "['module:react-native-dotenv', { moduleName: '@env', path: '.env' }]";

function arrayIn(content: string) {
  const file = parseSource(content, 'x.ts');
  let found: ts.ArrayLiteralExpression | undefined;
  const visit = (node: ts.Node) => {
    if (!found && ts.isArrayLiteralExpression(node)) found = node;
    node.forEachChild(visit);
  };
  visit(file);
  return { file, array: found! };
}

describe('arrayElementInsertion / arrayElementRemoval', () => {
  it('keeps a one-line list on one line', () => {
    const source = "const list = ['a', 'b'];\n";
    const { file, array } = arrayIn(source);
    const added = applyEdits(source, arrayElementInsertion(source, file, array, ["'c'", "'d'"]));
    expect(added).toBe("const list = ['a', 'b', 'c', 'd'];\n");
    const again = arrayIn(added);
    const targets = again.array.elements.filter((element) => ["'b'", "'d'"].includes(element.getText(again.file)));
    expect(applyEdits(added, arrayElementRemoval(added, again.file, again.array, targets))).toBe("const list = ['a', 'c'];\n");
  });

  it('adds lines to a multi-line list in its own indentation and comma habit', () => {
    const trailing = "const list = [\n    'a',\n    'b',\n];\n";
    const one = arrayIn(trailing);
    expect(applyEdits(trailing, arrayElementInsertion(trailing, one.file, one.array, ["'c'"]))).toBe(
      "const list = [\n    'a',\n    'b',\n    'c',\n];\n",
    );

    const bare = 'const list = [\n  "a",\n  "b"\n];\n';
    const two = arrayIn(bare);
    const added = applyEdits(bare, arrayElementInsertion(bare, two.file, two.array, ['"c"']));
    expect(added).toBe('const list = [\n  "a",\n  "b",\n  "c"\n];\n');
    const three = arrayIn(added);
    const last = three.array.elements[2]!;
    expect(applyEdits(added, arrayElementRemoval(added, three.file, three.array, [last]))).toBe(bare);
  });

  it('inserts before a given element', () => {
    const source = "const list = [\n  'a',\n  'z',\n];\n";
    const { file, array } = arrayIn(source);
    expect(applyEdits(source, arrayElementInsertion(source, file, array, ["'m'"], 1))).toBe(
      "const list = [\n  'a',\n  'm',\n  'z',\n];\n",
    );
  });

  it('compares code, not quoting or spacing', () => {
    expect(sameCode(RESOLVER, `["module-resolver", {root: ["./src"], alias: {"@": "./src"},}]`)).toBe(true);
    expect(sameCode(REANIMATED, "'react-native-gesture-handler'")).toBe(false);
  });
});

describe('babel.config.js', () => {
  it('adds to React Native’s own config and takes it back out to the same bytes', () => {
    const added = addBabelPlugins(TEMPLATE_BABEL, [REANIMATED]);
    expect(added.changed).toBe(true);
    expect(sourceSyntaxErrors(added.content, 'babel.config.js')).toEqual([]);
    expect(removeBabelPlugins(added.content, [REANIMATED]).content).toBe(TEMPLATE_BABEL);
  });

  it('keeps react-native-reanimated/plugin last', () => {
    const withReanimated = addBabelPlugins(TEMPLATE_BABEL, [REANIMATED]).content;
    const both = addBabelPlugins(withReanimated, [RESOLVER]).content;
    expect(both.indexOf('module-resolver')).toBeLessThan(both.indexOf('reanimated'));

    const generated = buildBabelConfigSource(null, [REANIMATED]);
    const patched = addBabelPlugins(generated, [DOTENV]).content;
    expect(patched).toBe(buildBabelConfigSource(null, [DOTENV, REANIMATED]));
    expect(removeBabelPlugins(patched, [DOTENV]).content).toBe(generated);
  });

  it('keeps entries someone added, and re-running changes nothing', () => {
    const custom = "module.exports = {\n  presets: ['module:@react-native/babel-preset'],\n  plugins: ['my-own-plugin'],\n};\n";
    const added = addBabelPlugins(custom, [REANIMATED]);
    expect(added.content).toContain("'my-own-plugin'");
    expect(addBabelPlugins(added.content, [REANIMATED]).already).toBe(true);
    const removed = removeBabelPlugins(added.content, [REANIMATED]);
    expect(removed.content).toBe(custom);
    expect(removeBabelPlugins(removed.content, [REANIMATED]).already).toBe(true);
  });

  it('refuses a config it would have to guess about', () => {
    const computed = 'const base = require("./base");\nmodule.exports = base;\n';
    const refused = addBabelPlugins(computed, [REANIMATED]);
    expect(refused.changed).toBe(false);
    expect(refused.already).toBeFalsy();
    expect(refused.manual).toContain('react-native-reanimated/plugin');
    expect(addBabelPlugins("module.exports = {\n  plugins: getPlugins(),\n};\n", [REANIMATED]).changed).toBe(false);
  });
});

describe('index.js prelude', () => {
  const INDEX = "/**\n * @format\n */\n\nimport {AppRegistry} from 'react-native';\n";
  const GESTURES = "import 'react-native-gesture-handler';";

  it('adds a line above everything and takes it back out with its blank line', () => {
    const added = addEntryPrelude(INDEX, [GESTURES]);
    expect(added.content.startsWith(`${GESTURES}\n\n/**`)).toBe(true);
    expect(addEntryPrelude(added.content, [GESTURES]).already).toBe(true);
    const removed = removeEntryPrelude(added.content, [GESTURES]);
    expect(removed.content).toBe(INDEX);
    expect(removeEntryPrelude(removed.content, [GESTURES]).already).toBe(true);
  });

  it('joins a prelude block other plugins already wrote', () => {
    const existing = "import 'first-side-effect';";
    const withOne = addEntryPrelude(INDEX, [existing]).content;
    const withTwo = addEntryPrelude(withOne, [GESTURES], [existing]).content;
    expect(withTwo.startsWith(`${existing}\n${GESTURES}\n\n`)).toBe(true);
    expect(removeEntryPrelude(withTwo, [GESTURES]).content).toBe(withOne);
  });
});

describe('runtime.generated', () => {
  const SPLASH = { minSplashDurationMs: 800, splashScreenComponent: { importName: 'default', from: '../src/armemon-examples/StartupSplash' } };
  const base = generateRuntimeConfigSource({
    orderedPlugins: [
      { packageName: '@armemon-library/advanced-init', runtimeExportName: 'AdvancedInitPlugin' },
      { packageName: './ui/index', runtimeExportName: 'UiPlugin' },
    ],
    language: 'typescript',
  });

  it('registers a plugin, its values and its component, and removes all three again', () => {
    const added = patchRuntimeGenerated(base, {
      addPlugins: [{ importName: 'SplashPlugin', from: './splash/index', before: './ui/index' }],
      contributions: { before: {}, after: SPLASH },
    });
    expect(added.changed).toBe(true);
    expect(sourceSyntaxErrors(added.content, 'runtime.generated.ts')).toEqual([]);
    expect(added.content).toMatch(/import \{ SplashPlugin as plugin2 \} from '\.\/splash\/index';/);
    expect(added.content).toContain('plugins: [plugin0, plugin2, plugin1]');
    expect(added.content).toMatch(/SplashScreenComponent,\n {2}minSplashDurationMs: 800,\n {2}\/\/ Spread last/);

    const removed = patchRuntimeGenerated(added.content, {
      removePlugins: ['./splash/index'],
      contributions: { before: SPLASH, after: {} },
    });
    expect(removed.content).toBe(base);
  });

  it('changes nothing when the plugin is already registered', () => {
    expect(patchRuntimeGenerated(base, { addPlugins: [{ importName: 'UiPlugin', from: './ui' }] }).already).toBe(true);
    expect(patchRuntimeGenerated(base, { removePlugins: ['./navigation/index'] }).already).toBe(true);
  });

  it('refuses a file that no longer calls registerRuntimeConfig with an object', () => {
    const refused = patchRuntimeGenerated("import config from './config';\nregisterRuntimeConfig(config);\n", {
      addPlugins: [{ importName: 'UiPlugin', from: './ui/index' }],
    });
    expect(refused.changed).toBe(false);
    expect(refused.already).toBeFalsy();
    expect(refused.manual).toBeTruthy();
  });
});

describe('web/index.html', () => {
  const template = buildWebScaffoldPlan('19.0.0', ['react']).filesToWrite.find((file) => file.path === 'web/index.html')!.content;
  const splash = {
    pluginId: 'splash',
    head: ['<style>\n      #armemon-splash { background: $&#fff; }\n    </style>'],
    bodyStart: ['<div id="armemon-splash"></div>'],
  };

  it('adds between markers exactly as init writes, and removes back to the template', () => {
    const init = applyHtmlContributions(template, [splash]);
    expect(init).toContain('<!-- armemon:splash -->');
    // `$&` is literal text in a contribution, not a replacement pattern.
    expect(init).toContain('background: $&#fff;');
    expect(addHtmlContributions(template, [splash]).content).toBe(init);
    expect(addHtmlContributions(init, [splash]).already).toBe(true);
    expect(removeHtmlContributions(init, [splash]).content).toBe(template);
    expect(removeHtmlContributions(template, [splash]).already).toBe(true);
  });

  it('refuses to remove markup someone edited', () => {
    const edited = applyHtmlContributions(template, [splash]).replace('#fff', '#000');
    const refused = removeHtmlContributions(edited, [splash]);
    expect(refused.changed).toBe(false);
    expect(refused.already).toBeFalsy();
    expect(refused.manual).toContain('<!-- armemon:splash -->');
  });

  it('removes markup a page got before markers existed', () => {
    const legacy = applyHtmlContributions(template, [{ ...splash, pluginId: undefined }]);
    expect(removeHtmlContributions(legacy, [splash]).content).toBe(template);
  });
});

describe('jest.setup.js and jest.resolver.js', () => {
  const noOfficial = () => false;

  it('adds and removes mocks to exactly what a new app would have', () => {
    const one = buildJestSetupSource(['react-native-bootsplash'], noOfficial);
    const three = buildJestSetupSource(['react-native-bootsplash', 'react-native-reanimated', 'react-native-gesture-handler'], noOfficial);
    expect(patchJestSetup(one, { add: ['react-native-reanimated', 'react-native-gesture-handler'] }, noOfficial).content).toBe(three);
    expect(patchJestSetup(three, { remove: ['react-native-reanimated', 'react-native-gesture-handler'] }, noOfficial).content).toBe(one);
    const none = buildJestSetupSource([], noOfficial);
    expect(patchJestSetup(one, { remove: ['react-native-bootsplash'] }, noOfficial).content).toBe(none);
    expect(patchJestSetup(none, { add: ['react-native-bootsplash'] }, noOfficial).content).toBe(one);
  });

  it('removes a mock in either form armemon writes, and refuses one written by hand', () => {
    const official = (specifier: string) => specifier.includes('netinfo');
    const withOfficial = buildJestSetupSource(['@react-native-community/netinfo'], official);
    expect(patchJestSetup(withOfficial, { remove: ['@react-native-community/netinfo'] }).content).toBe(buildJestSetupSource([]));

    const custom = "/* eslint-env jest */\n\njest.mock('react-native-bootsplash', () => ({ hide: jest.fn() }));\n";
    const refused = patchJestSetup(custom, { remove: ['react-native-bootsplash'] }, noOfficial);
    expect(refused.changed).toBe(false);
    expect(refused.already).toBeFalsy();
    expect(patchJestSetup(custom, { add: ['react-native-bootsplash'] }, noOfficial).already).toBe(true);
  });

  it('keeps the resolver’s pins sorted as the generator writes them', () => {
    const before = buildJestResolverSource(['react-native-bootsplash']);
    const after = buildJestResolverSource(['react-native-bootsplash', '@react-navigation/native', 'react-native-screens']);
    expect(patchJestResolverPins(before, { add: ['@react-navigation/native', 'react-native-screens'] }).content).toBe(after);
    expect(patchJestResolverPins(after, { remove: ['@react-navigation/native', 'react-native-screens'] }).content).toBe(before);
    expect(patchJestResolverPins(before, { add: ['react-native-bootsplash'] }).already).toBe(true);
  });
});

describe('metro.config.js', () => {
  it('adds and removes a linked package folder to what the generator writes', () => {
    const before = buildMetroConfigSource(['/checkout/core', '/checkout/config-types']);
    const after = buildMetroConfigSource(['/checkout/core', '/checkout/config-types', '/checkout/redux']);
    expect(patchMetroWatchFolders(before, { add: ['/checkout/redux'] }).content).toBe(after);
    expect(patchMetroWatchFolders(after, { remove: ['/checkout/redux'] }).content).toBe(before);
    expect(patchMetroWatchFolders(after, { add: ['/checkout/redux'] }).already).toBe(true);
  });

  it("refuses React Native's own config, which has no watchFolders list", () => {
    const stock = "const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');\nmodule.exports = mergeConfig(getDefaultConfig(__dirname), {});\n";
    expect(patchMetroWatchFolders(stock, { add: ['/checkout/redux'] }).changed).toBe(false);
  });
});

describe('App entry', () => {
  for (const language of ['typescript', 'javascript'] as const) {
    it(`swaps what a ${language} entry renders, both ways, to what init writes`, () => {
      const welcome = buildAppEntrySource({ root: 'welcome', language });
      const navigation = buildAppEntrySource({ root: 'navigation', language });
      expect(swapAppEntryRoot(welcome, 'navigation', { language }).content).toBe(navigation);
      expect(swapAppEntryRoot(navigation, 'welcome', { language }).content).toBe(welcome);
      expect(swapAppEntryRoot(navigation, 'navigation', { language }).already).toBe(true);
    });
  }

  it('keeps everything else someone wrote, and refuses a root with props', () => {
    const navigation = buildAppEntrySource({ root: 'navigation' });
    const wrapped = navigation
      .replace("import React from 'react';", "import React from 'react';\nimport { ThemeGate } from './src/ThemeGate';")
      .replace('<RootNavigator />', '<ThemeGate>\n        <RootNavigator />\n      </ThemeGate>');
    const swapped = swapAppEntryRoot(wrapped, 'welcome');
    expect(swapped.changed).toBe(true);
    expect(swapped.content).toContain('<ThemeGate>\n        <WelcomeScreen />');

    const withProps = swapAppEntryRoot(navigation.replace('<RootNavigator />', '<RootNavigator theme="dark" />'), 'welcome');
    expect(withProps.changed).toBe(false);
    expect(withProps.already).toBeFalsy();
  });
});

describe('web/vite.config', () => {
  const viteOf = (contributions: Parameters<typeof buildWebScaffoldPlan>[2], dedupe = ['react', 'react-dom']) =>
    buildWebScaffoldPlan('19.0.0', dedupe, contributions).filesToWrite.find((file) => file.path === 'web/vite.config.ts')!.content;
  const plain = viteOf([]);
  const full = viteOf([{ aliases: { '@': 'src' }, envModules: { '@env': '.env' } }]);

  it('adds aliases and env modules to exactly what the generator writes, and removes them again', () => {
    expect(patchViteConfig(plain, { addAliases: { '@': 'src' }, addEnvModules: { '@env': '.env' } }).content).toBe(full);
    expect(patchViteConfig(full, { removeAliases: ['@'], removeEnvModules: ['@env'] }).content).toBe(plain);
    expect(patchViteConfig(full, { addAliases: { '@': 'src' }, addEnvModules: { '@env': '.env' } }).already).toBe(true);
  });

  it('follows dedupe', () => {
    const added = patchViteConfig(plain, { addDedupe: ['react-redux'] }).content;
    expect(readViteDedupe(added)).toEqual(['react', 'react-dom', 'react-redux']);
    expect(patchViteConfig(added, { removeDedupe: ['react-redux'] }).content).toBe(plain);
  });

  it('round-trips a JavaScript config, which has no type imports to add', async () => {
    const [js] = (await convertFilesToJavaScript([{ path: 'web/vite.config.ts', content: plain }])).files;
    const added = patchViteConfig(js!.content, { addAliases: { '@': 'src' }, addEnvModules: { '@env': '.env' } }, 'vite.config.js');
    expect(added.changed).toBe(true);
    expect(added.content).not.toContain('Plugin');
    expect(sourceSyntaxErrors(added.content, 'vite.config.js')).toEqual([]);
    expect(patchViteConfig(added.content, { removeAliases: ['@'], removeEnvModules: ['@env'] }, 'vite.config.js').content).toBe(js!.content);
  });
});

describe('small pieces', () => {
  it('appends gitignore entries once', () => {
    const once = gitignoreWithEntries('node_modules/\n', ['.env', '.env.local']);
    expect(once).toBe('node_modules/\n\n# Added by armemon\n.env\n.env.local\n');
    expect(gitignoreWithEntries(once, ['.env'])).toBe(once);
  });

  it('lists every module a file names, and the package of each', () => {
    const refs = moduleReferences(
      "import a from '@scope/pkg/sub';\nconst b = require('lodash/fp');\njest.mock('./local');\nexport * from 'node:fs';\n",
      'x.ts',
    );
    expect(refs.map((ref) => [ref.specifier, ref.line])).toEqual([
      ['@scope/pkg/sub', 1],
      ['lodash/fp', 2],
      ['./local', 3],
      ['node:fs', 4],
    ]);
    expect(refs.map((ref) => packageNameOf(ref.specifier))).toEqual(['@scope/pkg', 'lodash', null, null]);
  });

  it('reads armemon.config without reordering it', () => {
    const config = validateAppConfig({
      appName: 'App',
      rnVersion: '0.76.0',
      platforms: ['ios'],
      packageManager: 'npm',
      language: 'typescript',
      plugins: {},
    });
    expect(Object.keys(config)).toEqual(['appName', 'rnVersion', 'platforms', 'packageManager', 'language', 'plugins']);
    expect(Object.keys(validateAppConfig({ appName: 'App', rnVersion: '0.76.0', platforms: [], packageManager: 'npm' }))).toEqual([
      'appName',
      'rnVersion',
      'platforms',
      'packageManager',
      'language',
      'plugins',
    ]);
  });
});

describe('JSON merges', () => {
  const TSCONFIG = '{\n  "extends": "@react-native/typescript-config/tsconfig.json"\n}\n';
  const ALIAS = { compilerOptions: { paths: { '@/*': ['./src/*'] } } };

  it('merges keys in and takes exactly them back out, to the same bytes', () => {
    const merged = mergeJsonValues(TSCONFIG, ALIAS, 'tsconfig.json');
    expect(JSON.parse(merged.content)).toEqual({ extends: '@react-native/typescript-config/tsconfig.json', ...ALIAS });
    expect(mergeJsonValues(merged.content, ALIAS, 'tsconfig.json').already).toBe(true);
    expect(unmergeJsonValues(merged.content, ALIAS, 'tsconfig.json').content).toBe(TSCONFIG);
    expect(unmergeJsonValues(TSCONFIG, ALIAS, 'tsconfig.json').already).toBe(true);
  });

  it('keeps what else is there, and a value someone changed', () => {
    const own = '{\n  "compilerOptions": {\n    "strict": true,\n    "paths": {\n      "~/*": ["./app/*"]\n    }\n  }\n}\n';
    const merged = mergeJsonValues(own, ALIAS, 'tsconfig.json').content;
    expect(JSON.parse(merged).compilerOptions.paths).toEqual({ '~/*': ['./app/*'], '@/*': ['./src/*'] });
    expect(JSON.parse(unmergeJsonValues(merged, ALIAS, 'tsconfig.json').content)).toEqual(JSON.parse(own));

    const changed = merged.replace('"./src/*"', '"./source/*"');
    expect(unmergeJsonValues(changed, ALIAS, 'tsconfig.json').already).toBe(true);
  });

  it('refuses a file with comments rather than dropping them', () => {
    const commented = '{\n  // ours\n  "extends": "x"\n}\n';
    const refused = mergeJsonValues(commented, ALIAS, 'tsconfig.json');
    expect(refused.changed).toBe(false);
    expect(refused.already).toBeFalsy();
    expect(refused.manual).toContain('"@/*"');
  });

  it('leaves what another plugin merges too', () => {
    expect(subtractJsonValues(ALIAS, [{ compilerOptions: { paths: { '@/*': ['./src/*'] } } }])).toEqual({});
    expect(subtractJsonValues({ a: 1, b: { c: 2, d: 3 } }, [{ b: { c: 2 } }])).toEqual({ a: 1, b: { d: 3 } });
  });
});
