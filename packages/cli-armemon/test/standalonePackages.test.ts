/**
 * FILE: standalonePackages.test.ts
 * PATH: packages/cli-armemon/test/standalonePackages.test.ts
 *
 * WHAT: The packages people can install without the CLI stay light and correctly named.
 * WHY:  Every plugin used to list @armemon-library/cli-kit as a real dependency. The
 *       runtime never loads it — only the `./wizard` entry does, and only the CLI loads
 *       that — but npm installs dependencies regardless of which entry you import, so
 *       adding one plugin to an app downloaded TypeScript, Prettier, execa and the rest.
 *       Nothing failed; installs were just quietly heavy. So both halves are checked:
 *       what package.json asks npm to install, and what the built runtime really imports.
 */
import { execFile, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import semver from 'semver';
import { describe, expect, it } from 'vitest';

const PACKAGES = fileURLToPath(new URL('../..', import.meta.url));
const execFileAsync = promisify(execFile);

/** Folder -> the name people install. */
const STANDALONE: Record<string, string> = {
  core: '@armemon-library/core',
  'plugin-redux': '@armemon-library/redux',
  'plugin-ui': '@armemon-library/ui',
  'plugin-navigation': '@armemon-library/navigation',
  'plugin-essentials': '@armemon-library/essentials',
  'builtin-splash': '@armemon-library/splash',
  'builtin-advanced-init': '@armemon-library/advanced-init',
};

/** Build and scaffolding tools. None of them belongs in an app. */
const HEAVY = [
  '@armemon-library/cli-kit',
  'typescript',
  'prettier',
  'execa',
  'semver',
  'chalk',
  '@clack/prompts',
  'commander',
];

interface Manifest {
  name: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  exports?: Record<string, unknown>;
}

const manifest = async (dir: string): Promise<Manifest> =>
  JSON.parse(await fs.readFile(path.join(PACKAGES, dir, 'package.json'), 'utf8')) as Manifest;

/** Every built JS entry an app can import: the runtime and its subpaths, never the wizard. */
async function runtimeEntries(dir: string): Promise<string[]> {
  const pkg = await manifest(dir);
  return Object.entries(pkg.exports ?? {})
    .filter(([subpath]) => subpath !== './wizard' && subpath !== './package.json')
    .map(([, target]) => {
      // { import: { types, default } } now; { import: '…' } for the wizard entries.
      const esm = (target as { import?: string | { default?: string } }).import;
      return typeof esm === 'string' ? esm : esm?.default;
    })
    .filter((file): file is string => typeof file === 'string')
    .map((file) => path.join(PACKAGES, dir, file));
}

describe.each(Object.entries(STANDALONE))('%s', (dir, name) => {
  it(`is published as ${name}`, async () => {
    expect((await manifest(dir)).name).toBe(name);
  });

  it('asks npm to install nothing but config-types', async () => {
    const dependencies = Object.keys((await manifest(dir)).dependencies ?? {});
    expect(
      dependencies.filter((dependency) => dependency !== '@armemon-library/config-types'),
    ).toEqual([]);
  });

  it('makes any build tool it declares an optional peer, so a plain install skips it', async () => {
    const pkg = await manifest(dir);
    for (const tool of HEAVY) {
      if (!(tool in (pkg.peerDependencies ?? {}))) continue;
      expect(pkg.peerDependenciesMeta?.[tool]?.optional, `${tool} must be optional`).toBe(true);
    }
  });

  /**
   * Changesets gives a package a major bump whenever a peer it lists gets a minor one,
   * unless the new version still fits the range. With `^0.1.0`, cli-kit's next minor
   * (0.2.0) falls outside the range, so every plugin would jump to 1.0.0. A range that
   * narrow would also make npm call each published plugin incompatible with the CLI's
   * newer cli-kit.
   */
  it("keeps cli-kit's next minor inside its peer range, so a cli-kit release doesn't force a major", async () => {
    const range = (await manifest(dir)).peerDependencies?.['@armemon-library/cli-kit'];
    if (range === undefined) return;

    const { version } = await manifest('cli-kit');
    const [major, minor] = version.split('.').map(Number);
    expect(semver.satisfies(version, range), `${range} must admit ${version}`).toBe(true);
    expect(
      semver.satisfies(`${major}.${minor + 1}.0`, range),
      `${range} must admit ${major}.${minor + 1}.0`,
    ).toBe(true);
  });

  it('never imports a build tool from the code an app runs', async () => {
    const entries = await runtimeEntries(dir);
    expect(entries.length).toBeGreaterThan(0);

    for (const entry of entries) {
      const code = await fs.readFile(entry, 'utf8');
      for (const tool of HEAVY) {
        const pattern = new RegExp(
          `from ?["']${tool.replace(/[/@]/g, '\\$&')}["'/]|import\\(["']${tool.replace(/[/@]/g, '\\$&')}`,
        );
        expect(pattern.test(code), `${path.relative(PACKAGES, entry)} imports ${tool}`).toBe(false);
      }
    }
  });
});

describe('releases', () => {
  /** The half of the fix that lives outside package.json: without it the range is ignored. */
  it('only major-bumps a peer dependent when the new version leaves its range', async () => {
    const config = JSON.parse(
      await fs.readFile(path.join(PACKAGES, '..', '.changeset', 'config.json'), 'utf8'),
    ) as {
      ___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH?: {
        onlyUpdatePeerDependentsWhenOutOfRange?: boolean;
      };
    };
    expect(
      config.___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH
        ?.onlyUpdatePeerDependentsWhenOutOfRange,
    ).toBe(true);
  });
});

/**
 * Only `@armemon-library` is ours on npm, so `armemon` and `memon` are commands of that
 * one package, not packages of their own: a global install gives both names, and
 * without one it runs as `npx @armemon-library/cli`.
 */
describe('the CLI', () => {
  const cliManifest = async () =>
    (await manifest('cli-armemon')) as Manifest & { bin?: Record<string, string> };

  it('is published as @armemon-library/cli, with the commands `armemon` and `memon`', async () => {
    const pkg = await cliManifest();
    expect(pkg.name).toBe('@armemon-library/cli');
    expect(Object.keys(pkg.bin ?? {})).toEqual(['armemon', 'memon']);
  });

  /**
   * `npx <package>` runs a command only when it can tell which one: one named after the
   * package (`cli` — there is none) or every command pointing at the same file. Point
   * `memon` at a second file and `npx @armemon-library/cli` fails with "could not
   * determine executable to run".
   */
  it('points both commands at one file, so npx can still pick one to run', async () => {
    expect(new Set(Object.values((await cliManifest()).bin ?? {})).size).toBe(1);
  });

  it.each(['armemon', 'memon'])('names itself `%s` when run as %s', async (command) => {
    const bin = path.join(PACKAGES, 'cli-armemon', (await cliManifest()).bin![command]!);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'armemon-bin-'));
    try {
      // What a global install puts on PATH: a link with the command's name.
      const link = path.join(dir, command);
      await fs.symlink(bin, link);
      const { stdout } = await execFileAsync(process.execPath, [link, '--help']);
      expect(stdout).toMatch(new RegExp(`^Usage: ${command} `));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

/**
 * What npm would really publish, asked of npm itself.
 *
 * Source maps shipped in every package — the CLI's was more than twice the size of
 * the bundle it described — pointing at src/ files that aren't published, so they
 * helped nobody. And an entry point missing from `files` is only noticed by whoever
 * installs the package.
 */
describe('published contents', () => {
  interface Packed {
    name: string;
    files: { path: string }[];
  }

  const packed = (): Packed[] => {
    const result = spawnSync('npm', ['pack', '--dry-run', '--json', '--workspaces'], {
      cwd: path.join(PACKAGES, '..'),
      encoding: 'utf8',
    });
    return JSON.parse(result.stdout) as Packed[];
  };

  it('ships no source maps and no declarations for the bin', () => {
    for (const pkg of packed()) {
      const paths = pkg.files.map((file) => file.path);
      expect(paths.filter((file) => file.endsWith('.map')), pkg.name).toEqual([]);
      expect(paths.filter((file) => file.startsWith('dist/bin/') && file.endsWith('.d.ts')), pkg.name).toEqual([]);
    }
  });

  it('ships every file its package.json points at', async () => {
    const byName = new Map(packed().map((pkg) => [pkg.name, new Set(pkg.files.map((file) => file.path))]));

    for (const dir of await fs.readdir(PACKAGES)) {
      const pkg = JSON.parse(await fs.readFile(path.join(PACKAGES, dir, 'package.json'), 'utf8')) as {
        name: string;
        main?: string;
        types?: string;
        bin?: Record<string, string>;
        exports?: Record<string, unknown>;
      };
      const shipped = byName.get(pkg.name);
      expect(shipped, pkg.name).toBeDefined();

      const targets: string[] = [];
      const collect = (value: unknown): void => {
        if (typeof value === 'string') targets.push(value);
        else if (value && typeof value === 'object') Object.values(value).forEach(collect);
      };
      collect([pkg.main, pkg.types, pkg.bin, pkg.exports]);

      for (const target of targets) {
        expect(shipped!.has(path.posix.normalize(target)), `${pkg.name} points at ${target}`).toBe(true);
      }
    }
  });
});

describe('armemon --version', () => {
  // The lookup matched the package by its old name, so after the rename every
  // version read as 0.0.0-unknown — in the line every bug report starts with.
  it('prints the version in the CLI’s package.json', async () => {
    const { version, bin } = (await manifest('cli-armemon')) as Manifest & {
      version: string;
      bin: Record<string, string>;
    };
    const { stdout } = await execFileAsync(process.execPath, [path.join(PACKAGES, 'cli-armemon', bin.armemon!), '--version']);
    expect(stdout.trim()).toBe(version);
  });
});
