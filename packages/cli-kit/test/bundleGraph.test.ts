/**
 * Bundle-graph guarantees.
 *
 * These assert a property no unit test of the wizards can: that an optional native
 * dependency is genuinely UNREACHABLE from a package's main entry point. Metro
 * resolves every import in a reachable module at bundle time whether or not it
 * executes, so "we only require it when the flag is on" is not a defence — the
 * import has to live in a module the app never mentions. That is what broke apps
 * which declined Redux persistence or Essentials' network monitoring, and this is
 * the check that stops it coming back.
 *
 * Reads the built output as text on purpose: it is the shipped artifact.
 */
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const packagesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative: string): string =>
  fs.readFileSync(path.join(packagesDir, relative), 'utf8');

describe('optional dependencies are unreachable from main entries', () => {
  it('plugin-redux main entry never mentions redux-persist or AsyncStorage', () => {
    const main = read('plugin-redux/dist/runtime/index.js');
    expect(main).not.toContain('redux-persist');
    expect(main).not.toContain('@react-native-async-storage/async-storage');
  });

  it('plugin-redux persist entry is where they actually live', () => {
    const adapter = read('plugin-redux/dist/runtime/persistAdapter.js');
    expect(adapter).toContain('redux-persist');
    expect(adapter).toContain('@react-native-async-storage/async-storage');
  });

  it('plugin-essentials main entry never mentions netinfo', () => {
    expect(read('plugin-essentials/dist/runtime/index.js')).not.toContain(
      '@react-native-community/netinfo',
    );
  });

  it('plugin-essentials netinfo entry is where it actually lives', () => {
    expect(read('plugin-essentials/dist/runtime/network/netInfoAdapter.js')).toContain(
      '@react-native-community/netinfo',
    );
  });
});

describe('config-types is inlined, not required at runtime', () => {
  // A runtime require of @armemon-library/config-types from inside a file:-linked package
  // resolves against the link target, where its sibling workspace packages are not
  // visible. That needed a Metro proxy, a pnpm override, and still broke Jest.
  // Bundling the single enum removes the require and all three workarounds.
  const entries = [
    'core/dist/index.js',
    'plugin-redux/dist/runtime/index.js',
    'plugin-navigation/dist/runtime/index.js',
    'plugin-essentials/dist/runtime/index.js',
    'plugin-ui/dist/runtime/index.js',
    'builtin-splash/dist/runtime/index.js',
    'builtin-advanced-init/dist/runtime/index.js',
  ];

  it.each(entries)('%s has no @armemon-library/config-types require', (entry) => {
    expect(read(entry)).not.toContain('@armemon-library/config-types');
  });
});

describe('runtime entries keep react and react-native external', () => {
  // Bundling either would give an app two copies. They must stay requires.
  it.each(['core/dist/index.js', 'plugin-ui/dist/runtime/index.js'])(
    '%s requires react-native rather than inlining it',
    (entry) => {
      expect(read(entry)).toMatch(/require\("react-native"\)/);
    },
  );
});

describe('published entry points exist', () => {
  const expected: Array<[string, string[]]> = [
    ['core', ['dist/index.js', 'dist/index.mjs', 'dist/index.d.ts']],
    [
      'plugin-redux',
      [
        'dist/runtime/index.js',
        'dist/runtime/index.mjs',
        'dist/runtime/persistAdapter.js',
        'dist/runtime/persistAdapter.mjs',
        'dist/wizard/index.mjs',
      ],
    ],
    [
      'plugin-essentials',
      [
        'dist/runtime/index.js',
        'dist/runtime/network/netInfoAdapter.js',
        'dist/runtime/network/netInfoAdapter.mjs',
        'dist/wizard/index.mjs',
      ],
    ],
  ];

  it.each(expected)('%s ships every file its exports map promises', (pkg, files) => {
    for (const file of files) {
      expect(fs.existsSync(path.join(packagesDir, pkg, file)), `${pkg}/${file}`).toBe(true);
    }
  });

  it('every package.json exports target actually exists', () => {
    const dirs = fs
      .readdirSync(packagesDir)
      .filter((entry) => fs.existsSync(path.join(packagesDir, entry, 'package.json')));

    for (const dir of dirs) {
      const pkg = JSON.parse(read(`${dir}/package.json`)) as { exports?: Record<string, unknown> };
      // Conditions nest — { import: { types, default }, require: { … } } — so every
      // string at any depth is a target.
      const leaves = (value: unknown): string[] =>
        typeof value === 'string'
          ? [value]
          : value && typeof value === 'object'
            ? Object.values(value).flatMap(leaves)
            : [];
      for (const [subpath, target] of Object.entries(pkg.exports ?? {})) {
        for (const relative of leaves(target)) {
          expect(
            fs.existsSync(path.join(packagesDir, dir, relative)),
            `${dir} exports "${subpath}" -> ${relative}`,
          ).toBe(true);
        }
      }
    }
  });
});

describe('subpath entry points resolve under Metro, not just Node', () => {
  // Metro in React Native 0.76 does not honour package.json "exports" by default
  // (unstable_enablePackageExports is opt-in until ~0.79), so a subpath that Node,
  // Vite, Jest and TypeScript all resolve happily still fails in an app bundle —
  // confirmed by running a real `react-native bundle`, which is the only check that
  // catches it. The pre-exports directory shim is what makes these resolve there.
  const shims: Array<[string, string]> = [
    ['plugin-essentials/netinfo', 'plugin-essentials'],
    ['plugin-redux/persist', 'plugin-redux'],
  ];

  it.each(shims)('%s has a resolution shim pointing at real files', (shimPath, owner) => {
    const manifestPath = path.join(packagesDir, shimPath, 'package.json');
    expect(fs.existsSync(manifestPath), `${shimPath}/package.json`).toBe(true);

    const shim = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, string>;
    for (const field of ['main', 'module', 'react-native', 'types']) {
      const target = shim[field];
      expect(target, `${shimPath} is missing "${field}"`).toBeDefined();
      expect(
        fs.existsSync(path.resolve(path.dirname(manifestPath), target as string)),
        `${shimPath} "${field}" -> ${target}`,
      ).toBe(true);
    }

    // The shim directory must ship, or it exists only in the repo.
    const ownerPkg = JSON.parse(read(`${owner}/package.json`)) as { files: string[] };
    expect(ownerPkg.files).toContain(shimPath.split('/')[1]);
  });

  it.each(shims)('%s shim and exports map point at the same file', (shimPath, owner) => {
    const subpath = `./${shimPath.split('/')[1]}`;
    const ownerPkg = JSON.parse(read(`${owner}/package.json`)) as {
      exports: Record<string, { require: { default: string; types: string }; import: { default: string } }>;
    };
    const shim = JSON.parse(read(`${shimPath}/package.json`)) as Record<string, string>;

    const entry = ownerPkg.exports[subpath]!;
    const fromOwner = (relative: string) => path.resolve(packagesDir, owner, relative);
    const fromShim = (field: string) => path.resolve(packagesDir, shimPath, shim[field] as string);
    expect(fromShim('main')).toBe(fromOwner(entry.require.default));
    expect(fromShim('module')).toBe(fromOwner(entry.import.default));
    expect(fromShim('types')).toBe(fromOwner(entry.require.types));
  });
});
