/**
 * FILE: jestSetupWriter.ts
 * PATH: packages/cli-kit/src/fs/jestSetupWriter.ts
 *
 * WHAT: Writes jest.setup.js with mocks for whichever native modules the selected
 *       plugins actually pulled in, and registers it in jest.config.js.
 * WHY:  The RN template ships `__tests__/App.test.tsx`, which renders <App />. Once
 *       armemon has patched App.tsx, that render boots the whole KitProvider chain —
 *       bootsplash, netinfo, AsyncStorage, reanimated — and the stock jest preset
 *       mocks none of them, so a user's very first `npm test` in a freshly
 *       scaffolded app fails. armemon knows the exact set of native packages it
 *       installed, so it can write exactly the mocks that set needs and no more.
 * HOW:  A registry mapping package name -> the mock snippet for it. Several of these
 *       packages publish their own official jest mock (netinfo, async-storage,
 *       reanimated, gesture-handler), so the snippet defers to that rather than
 *       hand-rolling one; only bootsplash, which ships none, gets a written stub.
 *       Packages with no entry contribute nothing.
 * WHEN: Called once, near the end of the init flow, with the installed dependency
 *       names.
 *
 *
 *       patchJestSetup and patchJestResolverPins change one package's mock or pin in
 *       files that already exist, for `armemon plugin add/remove`, keeping any mock
 *       the author wrote themselves.
 *
 * EXPORTS: buildJestSetupSource, buildJestConfigSource, writeJestSetup,
 *          buildJestResolverSource, buildTransformIgnorePattern, buildAppTestSource,
 *          resolveJestPreset, JEST_MOCKABLE_PACKAGES, officialMockProbe, jestResolverPins,
 *          patchJestSetup, patchJestResolverPins
 * DEPENDS ON: node:path, node:fs/promises, typescript, ./sourceEdit, ./arrayLiteralEdit,
 *             ./patchResult
 * USED BY: packages/cli-armemon/src/flows/initReactNative.ts,
 *          packages/cli-armemon/src/flows/plugins/reconcile.ts
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { formatGeneratedSource, stripTypes } from './languageConversion.js';
import { applyEdits, parseSource } from './sourceEdit.js';
import { arrayElementInsertion, arrayElementRemoval } from './arrayLiteralEdit.js';
import { brokenReason, checked, refused, type PatchResult } from './patchResult.js';

/**
 * How to mock each native module armemon can install.
 *
 * `official` is the package's own published jest mock, used when it exists —
 * `inline` is the fallback. Both are needed because a package can move or drop its
 * mock between majors: @react-native-async-storage/async-storage shipped
 * `jest/async-storage-mock` in v1/v2 and no longer does in v3, so hardcoding that
 * path broke every app scaffolded against a current React Native. Probing at
 * generation time means the setup file matches what is actually installed.
 */
interface MockSpec {
  official?: string;
  inline: string;
}

const MOCKS: Record<string, MockSpec> = {
  'react-native-bootsplash': {
    inline: `jest.mock('react-native-bootsplash', () => ({
  hide: jest.fn().mockResolvedValue(undefined),
  show: jest.fn().mockResolvedValue(undefined),
  isVisible: jest.fn().mockResolvedValue(false),
  useHideAnimation: jest.fn(),
}));`,
  },
  '@react-native-community/netinfo': {
    official: '@react-native-community/netinfo/jest/netinfo-mock.js',
    inline: `jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(() => jest.fn()),
    fetch: jest.fn().mockResolvedValue({ isConnected: true, isInternetReachable: true }),
  },
}));`,
  },
  '@react-native-async-storage/async-storage': {
    official: '@react-native-async-storage/async-storage/jest/async-storage-mock',
    inline: `jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (key) => store.get(key) ?? null),
      setItem: jest.fn(async (key, value) => void store.set(key, value)),
      removeItem: jest.fn(async (key) => void store.delete(key)),
      clear: jest.fn(async () => void store.clear()),
      getAllKeys: jest.fn(async () => [...store.keys()]),
      multiGet: jest.fn(async (keys) => keys.map((k) => [k, store.get(k) ?? null])),
      multiSet: jest.fn(async (pairs) => pairs.forEach(([k, v]) => store.set(k, v))),
      multiRemove: jest.fn(async (keys) => keys.forEach((k) => store.delete(k))),
    },
  };
});`,
  },
  'react-native-reanimated': {
    official: 'react-native-reanimated/mock',
    inline: `jest.mock('react-native-reanimated', () => ({ __esModule: true, default: {} }));`,
  },
  'react-native-gesture-handler': {
    official: 'react-native-gesture-handler/jestSetup',
    inline: '// react-native-gesture-handler needs no mock in this configuration.',
  },
};

export const JEST_MOCKABLE_PACKAGES = Object.keys(MOCKS);

/** The mock one package gets, preferring its own published mock when it is installed. */
function mockSnippetFor(name: string, hasOfficialMock: (specifier: string) => boolean): string {
  const spec = MOCKS[name] as MockSpec;
  if (!spec.official || !hasOfficialMock(spec.official)) return spec.inline;
  return name === 'react-native-gesture-handler'
    ? `require('${spec.official}');`
    : `jest.mock('${name}', () => require('${spec.official}'));`;
}

const NO_MOCKS = '// No native modules needed mocking for the plugins you selected.';

export function buildJestSetupSource(
  installedPackages: string[],
  /** Injected so generation can probe what is really installed; pure in tests. */
  hasOfficialMock: (specifier: string) => boolean = () => false,
): string {
  const snippets = JEST_MOCKABLE_PACKAGES.filter((name) => installedPackages.includes(name)).map((name) =>
    mockSnippetFor(name, hasOfficialMock),
  );

  // The eslint-env line: this file runs inside Jest but matches none of the test-file
  // patterns React Native's ESLint config gives Jest's globals, so `eslint .` failed
  // a brand-new app on "'jest' is not defined".
  return `/* eslint-env jest */

${snippets.length > 0 ? snippets.join('\n\n') : NO_MOCKS}
`;
}

/** Whether a package's own jest mock resolves from the app, as installed right now. */
export function officialMockProbe(appRoot: string): (specifier: string) => boolean {
  const requireFromApp = createRequire(path.join(appRoot, 'noop.js'));
  return (specifier: string): boolean => {
    try {
      requireFromApp.resolve(specifier);
      return true;
    } catch {
      return false;
    }
  };
}

/**
 * Adds and removes package mocks in an existing jest.setup.js.
 *
 * A mock comes out only when it is one armemon writes, in either form; a package
 * still named anywhere else in the file has a mock someone wrote, which is refused.
 * A package already named in the file counts as mocked when adding.
 */
export function patchJestSetup(
  content: string,
  change: { add?: string[]; remove?: string[] },
  hasOfficialMock: (specifier: string) => boolean = () => false,
): PatchResult {
  const fileName = 'jest.setup.js';
  const add = (change.add ?? []).filter((name) => JEST_MOCKABLE_PACKAGES.includes(name));
  const remove = (change.remove ?? []).filter((name) => JEST_MOCKABLE_PACKAGES.includes(name));
  const manual = [
    add.length > 0 ? `Mock ${add.join(', ')} in jest.setup.js:\n${add.map((name) => mockSnippetFor(name, hasOfficialMock)).join('\n\n')}` : null,
    remove.length > 0 ? `Remove the mocks for ${remove.join(', ')} from jest.setup.js.` : null,
  ].filter(Boolean).join('\n');

  const broken = brokenReason(content, fileName);
  if (broken) return refused(content, broken, manual);

  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  let output = eol === '\n' ? content : content.replace(/\r\n/g, '\n');
  const names = (name: string) => output.includes(`'${name}'`) || output.includes(`'${name}/`);

  for (const name of remove) {
    const spec = MOCKS[name] as MockSpec;
    const variants = [
      spec.inline,
      ...(spec.official
        ? [`jest.mock('${name}', () => require('${spec.official}'));`, `require('${spec.official}');`]
        : []),
    ];
    const variant = variants.find((text) => output.includes(text));
    if (!variant) {
      if (names(name)) {
        return refused(content, `jest.setup.js mocks ${name} in a way armemon didn't write`, manual);
      }
      continue;
    }
    const at = output.indexOf(variant);
    const end = at + variant.length;
    if (output.startsWith('\n\n', end)) output = output.slice(0, at) + output.slice(end + 2);
    else if (output.slice(0, at).endsWith('\n\n')) output = output.slice(0, at - 2) + output.slice(end);
    else output = output.slice(0, at) + output.slice(end);
  }

  const missing = add.filter((name) => !names(name));
  if (missing.length > 0) {
    const snippets = missing.map((name) => mockSnippetFor(name, hasOfficialMock)).join('\n\n');
    output = output.includes(NO_MOCKS)
      ? output.replace(NO_MOCKS, () => snippets)
      : `${output.trimEnd()}\n\n${snippets}\n`;
  }

  // Nothing left but the header: say so, as a new file does.
  if (output.trim() === '/* eslint-env jest */') output = `/* eslint-env jest */\n\n${NO_MOCKS}\n`;

  const next = eol === '\n' ? output : output.replace(/\n/g, eol);
  return checked(content, next, fileName, manual, 'jest.setup.js already mocks what the plugins need');
}

/** Every package jest.resolver.js pins, in the order it lists them. */
export function jestResolverPins(pinnedPackages: string[]): string[] {
  return [...new Set(['react', 'react-dom', 'react-native', ...pinnedPackages])]
    .filter((name) => !name.startsWith('@armemon-library/'))
    .sort();
}

export function buildJestResolverSource(pinnedPackages: string[]): string {
  const list = jestResolverPins(pinnedPackages)
    .map((name) => `  '${name}',`)
    .join('\n');

  return `// Generated by armemon.
//
// @armemon-library/* packages are installed as file: links while they're unpublished, so an
// import made from inside one resolves against the LINK TARGET's node_modules
// rather than this app's. That loads a second copy of React Native
// ("__fbBatchedBridgeConfig is not set"), a second React (hooks break), and native
// modules that jest.setup.js's mocks don't intercept because they're a different
// resolved module. metro.config.js solves the same problem with an extraNodeModules
// proxy; this is the Jest equivalent.
//
// Delete this file (and the "resolver" line in jest.config.js) once the @armemon
// packages are installed from the registry instead of by path.
const path = require('path');

const PINNED = new Set([
${list}
]);

// Match subpaths too, not just the bare specifier. React's automatic JSX runtime
// imports "react/jsx-runtime", which pinning only "react" left unpinned — so a
// linked package got one React and the app got another. Harmless while both were
// React 18; fatal on React 19, where the mismatch surfaces as
// "Cannot read properties of undefined (reading 'ReactCurrentDispatcher')".
const packageNameOf = (request) => {
  if (request.startsWith('.') || path.isAbsolute(request)) return null;
  const parts = request.split('/');
  return request.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
};

// Built lazily and only when rootDir is actually a string. Jest calls this resolver
// while normalising config too — to locate the transformer, for one — and in that
// pass options.rootDir is not set, so computing this eagerly threw a TypeError that
// surfaced as "module ... in the transform option was not found".
const appRootOptions = (options) =>
  typeof options.rootDir === 'string'
    ? {
        ...options,
        basedir: options.rootDir,
        paths: [path.join(options.rootDir, 'node_modules')],
      }
    : null;

module.exports = (request, options) => {
  // Shared singletons always come from the app, whoever imported them.
  if (PINNED.has(packageNameOf(request))) {
    const fromAppRoot = appRootOptions(options);
    if (fromAppRoot) {
      try {
        return options.defaultResolver(request, fromAppRoot);
      } catch {
        // Fall through to normal resolution below.
      }
    }
  }

  try {
    return options.defaultResolver(request, options);
  } catch (error) {
    // A linked package reaching for one of its own siblings.
    const fromAppRoot = appRootOptions(options);
    if (fromAppRoot) {
      try {
        return options.defaultResolver(request, fromAppRoot);
      } catch {
        throw error;
      }
    }
    throw error;
  }
};
`;
}

/**
 * Scopes and packages that must be transformed before a CommonJS Jest run can load
 * them, because they ship ES modules.
 *
 * React Native's own preset allow-lists only react-native and @react-native*, so
 * everything else fails with "SyntaxError: Unexpected token 'export'". This is
 * matched at SCOPE level rather than by package name on purpose: the failures come
 * from TRANSITIVE dependencies an app never lists itself. Confirmed against real
 * scaffolds — Redux Toolkit pulled in immer's legacy-esm build, and
 * @react-navigation/native pulled in @react-navigation/core. Enumerating direct
 * dependencies would have caught neither.
 */
const TRANSFORM_ALLOWLIST = [
  '(?:jest-)?react-native',
  'react-native-[^/]+',
  '@react-native(?:-community)?',
  '@react-navigation',
  '@reduxjs',
  '@armemon',
  'react-redux',
  'redux',
  'redux-thunk',
  'redux-persist',
  'immer',
  'reselect',
  'nanoid',
];

export function buildTransformIgnorePattern(): string {
  return `node_modules/(?!(?:${TRANSFORM_ALLOWLIST.join('|')})/)`;
}

/**
 * `linkedLocally`: the @armemon-library/* packages are `file:` links to a checkout,
 * which is the only case jest.resolver.js exists for. An app installed from npm
 * resolves them like any other package and gets no resolver.
 */
export function buildJestConfigSource(
  existing: string | null,
  preset: string,
  language: 'typescript' | 'javascript' = 'typescript',
  linkedLocally = false,
): string {
  if (existing?.includes('armemon')) return existing;

  if (language === 'javascript') {
    // React Native's preset transforms .js, .ts and .tsx — but NOT .jsx, which is
    // what a JavaScript app's components are. Jest then hits raw JSX and reports
    // "unexpected token". The preset object is spread and its transform map
    // extended, rather than replaced, so its asset transformer survives without
    // this file having to guess where that transformer lives.
    return `// Generated by armemon.${
      linkedLocally
        ? ` See jest.resolver.js for why a custom resolver is needed
// while the @armemon-library/* packages are linked by path rather than installed from npm.`
        : ''
    }
const preset = require('${preset}/jest-preset');

module.exports = {
  ...preset,
  setupFiles: [...(preset.setupFiles ?? []), '<rootDir>/jest.setup.js'],
${linkedLocally ? "  resolver: '<rootDir>/jest.resolver.js',\n" : ''}  // .jsx added — the preset omits it, and it is the extension a JavaScript app uses.
  transform: { ...preset.transform, '^.+\\.jsx$': 'babel-jest' },
  transformIgnorePatterns: [
    '${buildTransformIgnorePattern()}',
  ],
};
`;
  }

  return `// Generated by armemon.
//
${
  linkedLocally
    ? `// - resolver: see jest.resolver.js — needed while @armemon-library/* packages are linked by
//   path rather than installed from npm.
`
    : ''
}// - transformIgnorePatterns: React Native's preset only allows react-native itself
//   through the transform, so every other ESM-shipping dependency (Redux Toolkit's
//   immer, React Navigation, ...) has to be listed or Jest fails to parse it.
module.exports = {
  preset: '${preset}',
  setupFiles: ['<rootDir>/jest.setup.js'],
${linkedLocally ? "  resolver: '<rootDir>/jest.resolver.js',\n" : ''}  transformIgnorePatterns: [
    '${buildTransformIgnorePattern()}',
  ],
};
`;
}

/**
 * Replaces the React Native template's own `__tests__/App.test.tsx`.
 *
 * The template's version does a synchronous `act(() => create(<App />))`. That was
 * fine when App.tsx was a static tree, but armemon's App.tsx mounts KitProvider,
 * which runs the whole async init sequence on mount — so the render returns, the
 * test ends, Jest tears the environment down, and the init promise then resolves
 * into a setState on a dead environment ("You are trying to import a file after the
 * Jest environment has been torn down"). armemon rewrote App.tsx, so it owns the
 * test that renders it.
 */
export function buildAppTestSource(): string {
  return `/**
 * Generated by armemon. Replaces the React Native template's own smoke test, which
 * rendered <App /> synchronously — App.tsx now runs an async init sequence on mount
 * (see @armemon-library/core's KitProvider), so the render has to be awaited or the init
 * promise resolves after Jest has already torn the environment down.
 *
 * Safe to edit or delete once you have real tests.
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

describe('App', () => {
  it('mounts, finishes armemon init, and unmounts cleanly', async () => {
    let tree: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(<App />);
    });

    // Let the init phases and their state updates settle.
    await ReactTestRenderer.act(async () => {
      await Promise.resolve();
    });

    expect(tree).toBeDefined();
    expect(tree!.toJSON()).not.toBeNull();

    await ReactTestRenderer.act(async () => {
      tree!.unmount();
    });
  });
});
`;
}

export async function writeJestSetup(
  appRoot: string,
  installedPackages: string[],
  pinnedPackages: string[] = [],
  language: 'typescript' | 'javascript' = 'typescript',
  linkedLocally = false,
): Promise<void> {
  const hasOfficialMock = officialMockProbe(appRoot);

  await fs.writeFile(
    path.join(appRoot, 'jest.setup.js'),
    buildJestSetupSource(installedPackages, hasOfficialMock),
    'utf8',
  );

  // Only for file: links: see buildJestResolverSource. Published packages resolve
  // from the app's own node_modules, where the singletons already are.
  if (linkedLocally) {
    await fs.writeFile(
      path.join(appRoot, 'jest.resolver.js'),
      buildJestResolverSource(pinnedPackages.filter((name) => installedPackages.includes(name))),
      'utf8',
    );
  }

  const testDir = path.join(appRoot, '__tests__');
  await fs.mkdir(testDir, { recursive: true });
  // The RN template's own test is .tsx; a JavaScript app gets .jsx and the
  // TypeScript original is removed, or jest would run both.
  if (language === 'javascript') {
    await fs.rm(path.join(testDir, 'App.test.tsx'), { force: true });
  }
  const testFile = language === 'javascript' ? 'App.test.jsx' : 'App.test.tsx';
  // The test source is authored in TypeScript like every other template, so a
  // JavaScript app needs it stripped — it is written directly here rather than
  // through the plan's filesToWrite, so it would otherwise skip the conversion and
  // ship non-null assertions into a .jsx file.
  // The eslint-env line for JavaScript: React Native's ESLint config gives Jest's
  // globals to *.test.{js,ts,tsx} only, so App.test.jsx failed `npm run lint` on
  // "'describe' is not defined" in every new JavaScript app.
  const testSource =
    language === 'javascript'
      ? `/* eslint-env jest */\n${await formatGeneratedSource(stripTypes(buildAppTestSource(), testFile), testFile)}`
      : buildAppTestSource();
  await fs.writeFile(path.join(testDir, testFile), testSource, 'utf8');

  const configPath = path.join(appRoot, 'jest.config.js');
  const existing = await fs.readFile(configPath, 'utf8').catch(() => null);
  await fs.writeFile(
    configPath,
    buildJestConfigSource(existing, resolveJestPreset(appRoot), language, linkedLocally),
    'utf8',
  );
}

/**
 * Picks a preset that actually resolves from this app.
 *
 * The React Native template writes `preset: '@react-native/jest-preset'`, but that
 * package is not in RN 0.76's dependency tree — confirmed against a real scaffold,
 * where the template's own jest.config.js fails with "Preset
 * @react-native/jest-preset not found" before a single test runs. The react-native
 * package ships the same preset at its own root (react-native/jest-preset.js), so
 * `preset: 'react-native'` always works and is the fallback.
 */
export function resolveJestPreset(appRoot: string): string {
  const requireFromApp = createRequire(path.join(appRoot, 'noop.js'));
  // A Jest preset name is a MODULE, and Jest looks for `<module>/jest-preset.js`
  // inside it — so the candidates are package names, and the probe checks for that
  // file rather than for the package itself.
  for (const candidate of ['@react-native/jest-preset', 'react-native']) {
    try {
      requireFromApp.resolve(`${candidate}/jest-preset.js`);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  return 'react-native';
}

/** The `new Set([...])` list jest.resolver.js pins, or null when it isn't there. */
function pinnedList(file: ts.SourceFile): ts.ArrayLiteralExpression | null {
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'PINNED') continue;
      const init = declaration.initializer;
      if (init && ts.isNewExpression(init) && init.arguments?.[0] && ts.isArrayLiteralExpression(init.arguments[0])) {
        return init.arguments[0];
      }
    }
  }
  return null;
}

/** Adds and removes packages in jest.resolver.js's PINNED list, keeping it sorted. */
export function patchJestResolverPins(content: string, change: { add?: string[]; remove?: string[] }): PatchResult {
  const fileName = 'jest.resolver.js';
  const manual = [
    change.add?.length ? `Add ${change.add.map((name) => `'${name}'`).join(', ')} to PINNED in jest.resolver.js.` : null,
    change.remove?.length ? `Remove ${change.remove.map((name) => `'${name}'`).join(', ')} from PINNED in jest.resolver.js.` : null,
  ].filter(Boolean).join('\n');
  const broken = brokenReason(content, fileName);
  if (broken) return refused(content, broken, manual);

  let current = content;
  const read = () => {
    const file = parseSource(current, fileName);
    return { file, list: pinnedList(file) };
  };
  const text = (element: ts.Expression) => (ts.isStringLiteral(element) ? element.text : null);

  if (change.remove?.length) {
    const { file, list } = read();
    if (!list) return refused(content, "jest.resolver.js has no `const PINNED = new Set([...])`", manual);
    const targets = list.elements.filter((element) => change.remove!.includes(text(element) ?? ''));
    current = applyEdits(current, arrayElementRemoval(current, file, list, targets));
  }

  if (change.add?.length) {
    const { file, list } = read();
    if (!list) return refused(content, "jest.resolver.js has no `const PINNED = new Set([...])`", manual);
    const present = new Set(list.elements.map(text));
    const edits = [...new Set(change.add)]
      .filter((name) => !name.startsWith('@armemon-library/') && !present.has(name))
      .sort()
      .map((name) => {
        const index = list.elements.findIndex((element) => (text(element) ?? '') > name);
        return { name, index: index === -1 ? list.elements.length : index };
      });
    const byIndex = new Map<number, string[]>();
    for (const { name, index } of edits) byIndex.set(index, [...(byIndex.get(index) ?? []), `'${name}'`]);
    current = applyEdits(
      current,
      [...byIndex].flatMap(([index, names]) => arrayElementInsertion(current, file, list, names, index)),
    );
  }

  return checked(content, current, fileName, manual, 'jest.resolver.js already pins these packages');
}
