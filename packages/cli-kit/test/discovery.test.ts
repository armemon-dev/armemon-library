/**
 * Third-party plugin discovery.
 *
 * The manifest contract, the validated fields, the explicit runtimeExportName and
 * the dependsOn ordering all existed while being reachable by nobody but the CLI's
 * own bundled packages — the catalog was a hardcoded array, so nothing ever
 * enumerated a plugin the user installed. These tests cover the three separate
 * resolution seams that had to work for that to change: finding the package,
 * loading its ESM-only wizard, and declaring it in the generated app.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {
  discoverProjectPlugins,
  resolvePluginSpecifier,
  readPackageVersion,
  resolvePackageSubpathUrl,
  readArmemonManifest,
  isWorkspacePackage,
  buildArmemonDependencySpecifier,
  buildFileDependencySpecifier,
} from '../dist/index.js';

let root: string;

const writePackage = async (
  name: string,
  manifest: Record<string, unknown> | null,
  extra: Record<string, unknown> = {},
): Promise<string> => {
  const dir = path.join(root, 'node_modules', ...name.split('/'));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({ name, version: '2.3.4', ...(manifest ? { armemon: manifest } : {}), ...extra }, null, 2),
  );
  return dir;
};

const validManifest = {
  manifestVersion: 1,
  pluginId: 'analytics',
  displayName: 'Acme Analytics',
  description: 'Third-party.',
  runtimeExportName: 'AnalyticsPlugin',
};

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'armemon-discovery-'));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const setProjectDeps = (deps: Record<string, string>, dev: Record<string, string> = {}) =>
  fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'host', dependencies: deps, devDependencies: dev }, null, 2),
  );

describe('discoverProjectPlugins', () => {
  it('finds a plugin declared as a dependency of the project', async () => {
    await setProjectDeps({ '@acme/armemon-plugin-analytics': '^2.3.4' });
    await writePackage('@acme/armemon-plugin-analytics', validManifest);

    const found = await discoverProjectPlugins(root);
    expect(found).toHaveLength(1);
    expect(found[0]!.manifest.pluginId).toBe('analytics');
  });

  it('finds one declared as a devDependency too', async () => {
    await setProjectDeps({}, { '@acme/armemon-plugin-analytics': '^2.3.4' });
    await writePackage('@acme/armemon-plugin-analytics', validManifest);
    expect(await discoverProjectPlugins(root)).toHaveLength(1);
  });

  it('ignores ordinary packages without an armemon field', async () => {
    await setProjectDeps({ lodash: '^4.0.0' });
    await writePackage('lodash', null);
    expect(await discoverProjectPlugins(root)).toEqual([]);
  });

  it('skips a declared-but-not-installed dependency rather than throwing', async () => {
    await setProjectDeps({ 'never-installed': '^1.0.0' });
    expect(await discoverProjectPlugins(root)).toEqual([]);
  });

  it('returns nothing for a directory with no package.json', async () => {
    expect(await discoverProjectPlugins(root)).toEqual([]);
  });

  it('survives a malformed project package.json', async () => {
    await fs.writeFile(path.join(root, 'package.json'), '{ not json');
    expect(await discoverProjectPlugins(root)).toEqual([]);
  });

  it('skips a package whose armemon field is invalid, without failing the run', async () => {
    await setProjectDeps({ '@acme/broken': '^1.0.0' });
    await writePackage('@acme/broken', { pluginId: 'broken' });
    expect(await discoverProjectPlugins(root)).toEqual([]);
  });
});

describe('resolvePackageSubpathUrl', () => {
  it('resolves an ESM-only wizard export, which require-resolution cannot', async () => {
    // An exports entry with "import" but no "require" makes
    // createRequire().resolve() fail with ERR_PACKAGE_PATH_NOT_EXPORTED — which is
    // exactly how every armemon wizard is published.
    const dir = await writePackage('@acme/esm-only', validManifest, {
      exports: { '.': './index.js', './wizard': { import: './wizard.mjs' } },
    });
    await fs.writeFile(path.join(dir, 'wizard.mjs'), 'export default {};');

    const url = resolvePackageSubpathUrl('@acme/esm-only', 'wizard', { resolveFrom: [root] });
    expect(url.startsWith('file://')).toBe(true);
    expect(url.endsWith('wizard.mjs')).toBe(true);
  });

  it('accepts a plain string exports entry', async () => {
    const dir = await writePackage('@acme/string-exports', validManifest, {
      exports: { './wizard': './w.mjs' },
    });
    await fs.writeFile(path.join(dir, 'w.mjs'), 'export default {};');
    expect(
      resolvePackageSubpathUrl('@acme/string-exports', 'wizard', { resolveFrom: [root] }),
    ).toContain('w.mjs');
  });

  it('falls back to a path join for a package with no exports map', async () => {
    const dir = await writePackage('@acme/no-exports', validManifest);
    await fs.writeFile(path.join(dir, 'wizard'), 'ignored');
    expect(
      resolvePackageSubpathUrl('@acme/no-exports', 'wizard', { resolveFrom: [root] }),
    ).toContain('wizard');
  });

  it('reports a declared export whose file was never built', async () => {
    await writePackage('@acme/unbuilt', validManifest, {
      exports: { './wizard': { import: './dist/wizard.mjs' } },
    });
    expect(() =>
      resolvePackageSubpathUrl('@acme/unbuilt', 'wizard', { resolveFrom: [root] }),
    ).toThrow(/doesn't exist/);
  });
});

describe('resolvePluginSpecifier', () => {
  it('carries a file: link through as an absolute path', async () => {
    // Relative to the host, but the scaffolded app lives elsewhere.
    await setProjectDeps({ '@acme/local': 'file:../acme-local' });
    await writePackage('@acme/local', validManifest);

    const specifier = await resolvePluginSpecifier('@acme/local', root);
    expect(specifier.startsWith('file:/')).toBe(true);
    expect(specifier).toContain('acme-local');
  });

  it('keeps a registry range exactly as declared', async () => {
    await setProjectDeps({ '@acme/published': '~2.3.0' });
    await writePackage('@acme/published', validManifest);
    expect(await resolvePluginSpecifier('@acme/published', root)).toBe('~2.3.0');
  });

  it('falls back to the installed version when undeclared', async () => {
    await setProjectDeps({});
    await writePackage('@acme/undeclared', validManifest);
    expect(await resolvePluginSpecifier('@acme/undeclared', root)).toBe('^2.3.4');
  });

  it('reads the installed version', async () => {
    await writePackage('@acme/versioned', validManifest);
    expect(await readPackageVersion('@acme/versioned', [root])).toBe('2.3.4');
  });
});

describe('manifest validation for third-party packages', () => {
  it('rejects an unknown platform rather than silently hiding the plugin', async () => {
    await writePackage('@acme/bad-platform', { ...validManifest, platforms: ['tizen'] });
    await expect(
      readArmemonManifest('@acme/bad-platform', { resolveFrom: [root] }),
    ).rejects.toThrow(/unknown platform/i);
  });

  it('names the missing fields when the manifest is incomplete', async () => {
    await writePackage('@acme/incomplete', { pluginId: 'x' });
    await expect(readArmemonManifest('@acme/incomplete', { resolveFrom: [root] })).rejects.toThrow(
      /missing a valid "armemon" manifest/,
    );
  });

  it('defaults the optional fields', async () => {
    await writePackage('@acme/minimal', validManifest);
    const manifest = await readArmemonManifest('@acme/minimal', { resolveFrom: [root] });
    expect(manifest.required).toBe(false);
    expect(manifest.dependsOn).toEqual([]);
    expect(manifest.platforms).toBeUndefined();
  });
});

/**
 * How a scaffolded app depends on the armemon runtime.
 *
 * This is the one behaviour that is wrong in exactly the situation the test suite
 * cannot reach: running from this checkout, every @armemon-library/* package is a workspace
 * symlink and a `file:` path is correct. Installed from npm it is not — it would
 * point into the user's node_modules, or under npx into a cache directory that gets
 * cleaned, and every scaffolded app would carry a path meaningless anywhere else.
 * So the test pins the rule that separates the two cases rather than the output.
 */
describe('armemon runtime dependency specifiers', () => {
  it('links this checkout, where nothing is published yet', () => {
    expect(isWorkspacePackage('@armemon-library/core')).toBe(true);
    expect(buildArmemonDependencySpecifier('@armemon-library/core')).toBe(
      buildFileDependencySpecifier('@armemon-library/core'),
    );
  });

  it('treats a package under node_modules as installed', () => {
    // Every dependency that is not this monorepo's own source: react, and every
    // @armemon-library/* package once these are published and installed normally.
    expect(isWorkspacePackage('typescript')).toBe(false);
  });

  it('gives an installed package a caret range at its own version', () => {
    // The version the CLI shipped with is the version published alongside it, so
    // resolving the copy next to us is what makes the range correct.
    const specifier = buildArmemonDependencySpecifier('typescript');
    expect(specifier.startsWith('^')).toBe(true);
    expect(specifier).not.toContain('file:');
    expect(specifier).toMatch(/^\^\d+\.\d+\.\d+/);
  });

  // cli-kit depends on none of the packages it is asked about, so under a layout
  // that doesn't hoist (pnpm dlx, Yarn PnP) they are invisible from cli-kit itself.
  // The CLI passes its own directory, which does depend on them.
  it('resolves from the directories it is given before its own location', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'armemon-resolve-'));
    try {
      const pkgDir = path.join(root, 'node_modules', '@armemon-library', 'only-here');
      await fs.mkdir(pkgDir, { recursive: true });
      await fs.writeFile(
        path.join(pkgDir, 'package.json'),
        JSON.stringify({ name: '@armemon-library/only-here', version: '3.4.5' }),
      );

      expect(buildArmemonDependencySpecifier('@armemon-library/only-here')).toBe('latest');
      expect(buildArmemonDependencySpecifier('@armemon-library/only-here', { resolveFrom: [root] })).toBe('^3.4.5');
      expect(isWorkspacePackage('@armemon-library/only-here', { resolveFrom: [root] })).toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('never emits a file: path for something it could not resolve', () => {
    expect(isWorkspacePackage('@armemon-library/does-not-exist')).toBe(false);
    expect(buildArmemonDependencySpecifier('@armemon-library/does-not-exist')).toBe('latest');
  });
});

describe('what counts as claiming to be a plugin', () => {
  // The pre-check that decides whether a package is worth validating used to be a
  // substring search for "armemon". Every first-party package lists armemon as a
  // KEYWORD, so each one was reported as a broken plugin — a warning about armemon's
  // own packages, printed to a user who can do nothing about it.
  it('ignores a package that merely mentions armemon in its keywords', async () => {
    await writePackage('@armemon-library/core', null, {
      keywords: ['react-native', 'armemon'],
      dependencies: { '@armemon-library/config-types': '^0.1.0' },
    });
    await fs.writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({ dependencies: { '@armemon-library/core': '^0.1.0' } }),
      'utf8',
    );

    await expect(discoverProjectPlugins(root)).resolves.toEqual([]);
  });

  it('still reports a package whose armemon manifest is real but broken', async () => {
    await writePackage('busted-plugin', { pluginId: 'busted' });
    await fs.writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({ dependencies: { 'busted-plugin': '^1.0.0' } }),
      'utf8',
    );

    // Invalid manifests are skipped, not thrown on — but they are noticed, which is
    // the behaviour the keyword false-positive was drowning out.
    await expect(discoverProjectPlugins(root)).resolves.toEqual([]);
  });
});
