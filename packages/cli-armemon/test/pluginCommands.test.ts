/**
 * FILE: pluginCommands.test.ts
 * PATH: packages/cli-armemon/test/pluginCommands.test.ts
 *
 * WHAT: `armemon plugin add` and `plugin remove`, rule by rule (docs/plugins.md).
 * WHY:  These commands edit files people work in and uninstall packages. Each rule is a
 *       promise about what they will never do — lose an edit, break an import, leave an
 *       app half-changed — and each is pinned here against an app built from init's own
 *       generators, in TypeScript and in JavaScript.
 * HOW:  The real flows, with a stand-in npm (test/support/pluginApps.ts) and the
 *       type-check and web build left to the end-to-end run. A round trip is checked
 *       byte for byte: removing a plugin just added must give back the app that was
 *       there, apart from the leftovers rule R3 names.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runAddPluginFlow, runRemovePluginFlow } from '../dist/index.js';
import { captureStdout, resetCliState } from './support/screenApps';
import { makePluginApp, normalizedPackageJson, useFakeNpm, type PluginApp } from './support/pluginApps';

type Summary = {
  schemaVersion: number;
  ok: boolean;
  created?: string[];
  edited?: string[];
  deleted?: string[];
  blocked?: Array<{ rule: string; file?: string; reason: string; manual?: string }>;
  skipped?: Array<{ rule: string; file?: string }>;
  kept?: Array<{ file: string; reason: string }>;
  dependencies?: { added: Record<string, string>; removed: string[]; kept: Array<{ name: string; reason: string }> };
  removalNotes?: string[];
  alreadyInstalled?: boolean;
  notInstalled?: boolean;
  dryRun?: boolean;
  error?: { message: string };
};

let fakeNpm: { restore(): Promise<void> };
let app: PluginApp;

beforeAll(async () => {
  fakeNpm = await useFakeNpm();
});
afterAll(async () => {
  await fakeNpm.restore();
});
afterEach(async () => {
  await app?.remove();
  resetCliState();
});

const add = async (plugin: string, extra: Record<string, unknown> = {}): Promise<Summary> => {
  resetCliState();
  const out = await captureStdout(() =>
    runAddPluginFlow({ plugin, cwd: app.root, json: true, verify: false, ...extra }),
  );
  return JSON.parse(out) as Summary;
};
const remove = async (plugin: string, extra: Record<string, unknown> = {}): Promise<Summary> => {
  resetCliState();
  const out = await captureStdout(() =>
    runRemovePluginFlow({ plugin, cwd: app.root, json: true, verify: false, ...extra }),
  );
  return JSON.parse(out) as Summary;
};

/** The snapshot as a round trip compares it: npm's lockfile aside, package.json by content. */
function comparable(snapshot: Record<string, string>): Record<string, string> {
  const out = { ...snapshot };
  delete out['package-lock.json'];
  if (out['package.json']) out['package.json'] = normalizedPackageJson(out['package.json']);
  return out;
}

/** Navigation as a drawer, whose gestures need an index.js line and a Babel plugin. */
const DRAWER = {
  navigatorType: 'drawer',
  initialRouteName: 'Home',
  screenCount: 2,
  enableDeepLinking: true,
  typedRoutes: true,
  sampleAuthFlow: false,
  dependencyVersions: {
    '@react-navigation/native': '^7.0.14',
    'react-native-screens': '4.5.0',
    'react-native-safe-area-context': '5.1.0',
    '@react-navigation/drawer': '^7.1.1',
    'react-native-gesture-handler': '2.21.2',
    'react-native-reanimated': '3.16.6',
  },
};

/** A third-party plugin the app installed from npm, as its own node_modules would hold it. */
async function installAnalyticsPlugin(target: PluginApp, importName = 'AnalyticsPlugin'): Promise<void> {
  const app = target;
  // importName can differ from the manifest's runtimeExportName: what a plan registers is its own call.
  const pkg = JSON.parse(await app.read('package.json'));
  pkg.dependencies['armemon-plugin-analytics'] = '^1.0.0';
  await app.write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
  await app.write(
    'node_modules/armemon-plugin-analytics/package.json',
    JSON.stringify({
      name: 'armemon-plugin-analytics',
      version: '1.0.0',
      exports: { './wizard': './wizard.mjs', './package.json': './package.json' },
      armemon: {
        manifestVersion: 1,
        pluginId: 'analytics',
        displayName: 'Analytics',
        description: 'Screen tracking.',
        runtimeExportName: 'AnalyticsPlugin',
      },
    }),
  );
  await app.write(
    'node_modules/armemon-plugin-analytics/wizard.mjs',
    `export default {
pluginId: 'analytics',
intro: 'Analytics',
async run() { return { trackScreens: true }; },
async plan(answers, ctx) {
  const managed = ctx.layout?.managed ?? 'armemon';
  return {
    npmDependencies: {},
    filesToWrite: [{ path: managed + '/analytics/index.ts', content: 'export const ${importName} = { name: "analytics", trackScreens: ' + answers.trackScreens + ' };\\n' }],
    appEntryContributions: { providerImport: { importName: '${importName}', from: './analytics/index' }, registerInRuntimeConfig: true },
  };
},
};
`,
  );
}

/** What R3 says stays behind after removing each plugin — root files and ignore lines. */
const LEFTOVERS: Record<string, string[]> = {
  'advanced-init': ['.env', '.env.example', '.gitignore'],
  splash: [],
  ui: [],
  essentials: [],
  redux: [],
  navigation: [],
};

for (const language of ['typescript', 'javascript'] as const) {
  describe(`R6: add then remove gives back the same ${language} app`, () => {
    for (const plugin of Object.keys(LEFTOVERS)) {
      it(plugin, async () => {
        app = await makePluginApp({ language });
        const before = comparable(await app.snapshot());

        const added = await add(plugin);
        expect(added, JSON.stringify(added.blocked ?? added.error)).toMatchObject({ schemaVersion: 1, ok: true });
        expect(added.created?.length ?? 0).toBeGreaterThan(0);
        expect(added.edited).toContain(`armemon.config.${language === 'javascript' ? 'js' : 'ts'}`);
        expect(process.exitCode).toBe(0);

        // R7: a second add is a no-op, said so.
        expect(await add(plugin)).toMatchObject({ ok: true, alreadyInstalled: true });

        const removed = await remove(plugin);
        expect(removed, JSON.stringify(removed.blocked ?? removed.error)).toMatchObject({ ok: true });
        expect(await remove(plugin)).toMatchObject({ ok: true, notInstalled: true });

        const after = comparable(await app.snapshot());
        const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
          .filter((file) => before[file] !== after[file])
          .sort();
        expect(changed).toEqual([...LEFTOVERS[plugin]!].sort());
      });
    }
  });
}

describe('R1: worked out first, all or nothing', () => {
  beforeEach(async () => {
    app = await makePluginApp();
  });

  it('--dry-run reports the whole change and writes nothing', async () => {
    const before = await app.snapshot();
    const summary = await add('navigation', { dryRun: true, answers: DRAWER });
    expect(summary).toMatchObject({ ok: true, dryRun: true });
    expect(summary.created).toContain('armemon/navigation/RootNavigator.tsx');
    expect(summary.edited).toEqual(expect.arrayContaining(['App.tsx', 'babel.config.js', 'index.js', 'package.json']));
    expect(summary.dependencies?.added).toHaveProperty('@react-navigation/native');
    expect(await app.snapshot()).toEqual(before);
  });
});

describe('R2: your edits are never lost', () => {
  beforeEach(async () => {
    app = await makePluginApp();
  });

  it("stops removal at a plugin file you changed, and changes nothing", async () => {
    expect((await add('ui')).ok).toBe(true);
    const settings = 'armemon/ui/theme.config.ts';
    await app.write(settings, (await app.read(settings)).replace("themeMode: 'auto'", "themeMode: 'dark'"));
    const before = await app.snapshot();

    const summary = await remove('ui');
    expect(summary.ok).toBe(false);
    expect(summary.blocked).toEqual([expect.objectContaining({ rule: 'R2', file: settings })]);
    expect(process.exitCode).toBe(1);
    expect(await app.snapshot()).toEqual(before);
  });

  it('--force goes ahead, keeps that file exactly, and keeps the package it imports', async () => {
    expect((await add('ui')).ok).toBe(true);
    const settings = 'armemon/ui/theme.config.ts';
    const edited = (await app.read(settings)).replace("themeMode: 'auto'", "themeMode: 'dark'");
    await app.write(settings, edited);

    const summary = await remove('ui', { force: true });
    expect(summary.ok).toBe(true);
    expect(summary.skipped).toEqual([expect.objectContaining({ rule: 'R2', file: settings })]);
    expect(await app.read(settings)).toBe(edited);
    expect(await app.exists('armemon/ui/index.ts')).toBe(false);
    expect(summary.dependencies?.kept).toEqual([expect.objectContaining({ name: '@armemon-library/ui' })]);
    expect(await app.read('armemon/runtime.generated.ts')).not.toContain('UiPlugin');
  });

  it('stops adding where a file of yours already sits', async () => {
    await app.write('src/types/env.d.ts', "declare module '@env' {\n  export const MY_OWN: string;\n}\n");
    const before = await app.snapshot();
    const summary = await add('advanced-init');
    expect(summary.ok).toBe(false);
    expect(summary.blocked).toEqual([expect.objectContaining({ rule: 'R2', file: 'src/types/env.d.ts' })]);
    expect(await app.snapshot()).toEqual(before);
  });

  it('edits a babel.config.js you changed in place, and takes back only its own entry', async () => {
    const custom = "module.exports = {\n  presets: ['module:@react-native/babel-preset'],\n  plugins: ['my-own-plugin'],\n};\n";
    await app.write('babel.config.js', custom);
    expect((await add('navigation', { answers: DRAWER })).ok).toBe(true);
    const withNavigation = await app.read('babel.config.js');
    expect(withNavigation).toContain("'my-own-plugin'");
    expect(withNavigation.indexOf('my-own-plugin')).toBeLessThan(withNavigation.indexOf('react-native-reanimated/plugin'));

    expect((await remove('navigation')).ok).toBe(true);
    expect(await app.read('babel.config.js')).toBe(custom);
  });

  it('never writes over a .env the app already has', async () => {
    await app.write('.env', 'API_URL=https://real.example.com\n');
    const summary = await add('advanced-init');
    expect(summary.ok).toBe(true);
    expect(await app.read('.env')).toBe('API_URL=https://real.example.com\n');
    expect(summary.kept).toEqual(expect.arrayContaining([expect.objectContaining({ file: '.env' })]));
  });
});

describe('R4: removing never breaks the app on purpose', () => {
  beforeEach(async () => {
    app = await makePluginApp();
  });

  it('stops while app code imports the plugin, naming file and line', async () => {
    expect((await add('essentials')).ok).toBe(true);
    await app.write(
      'src/screens/HomeScreen/index.tsx',
      "import React from 'react';\nimport { useNotifications } from '@armemon-library/essentials';\n\nexport default function HomeScreen() {\n  useNotifications();\n  return null;\n}\n",
    );
    const summary = await remove('essentials');
    expect(summary.ok).toBe(false);
    expect(summary.blocked).toEqual([
      expect.objectContaining({ rule: 'R4', file: 'src/screens/HomeScreen/index.tsx:2' }),
    ]);

    const forced = await remove('essentials', { force: true });
    expect(forced.ok).toBe(true);
    expect(forced.dependencies?.kept).toEqual(expect.arrayContaining([expect.objectContaining({ name: '@armemon-library/essentials' })]));
    expect(JSON.parse(await app.read('package.json')).dependencies).toHaveProperty('@armemon-library/essentials');
  });

  it('stops while app code imports a file the plugin would delete', async () => {
    expect((await add('ui')).ok).toBe(true);
    await app.write('src/shared/theme.ts', "export { uiConfig } from '../../armemon/ui/theme.config';\n");
    const summary = await remove('ui');
    expect(summary.ok).toBe(false);
    expect(summary.blocked?.[0]).toMatchObject({ rule: 'R4', file: 'src/shared/theme.ts:1' });
    expect(summary.blocked?.[0]?.reason).toContain('armemon/ui/theme.config.ts');
  });

  it("stops while code imports @env, which only advanced-init provides", async () => {
    expect((await add('advanced-init')).ok).toBe(true);
    await app.write('src/shared/api.ts', "import { API_URL } from '@env';\n\nexport const api = API_URL;\n");
    const summary = await remove('advanced-init');
    expect(summary.ok).toBe(false);
    expect(summary.blocked).toEqual([expect.objectContaining({ rule: 'R4', file: 'src/shared/api.ts:1' })]);
  });
});

describe('R5: packages go only when nothing needs them', () => {
  beforeEach(async () => {
    app = await makePluginApp();
  });

  it('keeps a package app code imports', async () => {
    expect((await add('essentials')).ok).toBe(true);
    await app.write('src/shared/online.ts', "import NetInfo from '@react-native-community/netinfo';\n\nexport const online = NetInfo;\n");
    const summary = await remove('essentials');
    expect(summary.ok).toBe(true);
    expect(summary.dependencies?.removed).toEqual(['@armemon-library/essentials']);
    expect(summary.dependencies?.kept).toEqual([
      { name: '@react-native-community/netinfo', reason: 'imported by src/shared/online.ts:1' },
    ]);
    expect(await app.read('jest.setup.js')).toContain('@react-native-community/netinfo');
  });

  it('keeps a package another installed package peers on', async () => {
    expect((await add('essentials')).ok).toBe(true);
    const pkg = JSON.parse(await app.read('package.json'));
    pkg.dependencies['offline-sync'] = '^1.0.0';
    await app.write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
    await app.write(
      'node_modules/offline-sync/package.json',
      JSON.stringify({ name: 'offline-sync', version: '1.0.0', peerDependencies: { '@react-native-community/netinfo': '*' } }),
    );
    const summary = await remove('essentials');
    expect(summary.ok).toBe(true);
    expect(summary.dependencies?.kept).toEqual([
      { name: '@react-native-community/netinfo', reason: 'a peer dependency of offline-sync' },
    ]);
  });

  it('never changes a version already installed when adding', async () => {
    const pkg = JSON.parse(await app.read('package.json'));
    pkg.dependencies['@react-native-community/netinfo'] = '^9.0.0';
    await app.write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
    const summary = (await add('essentials')) as Summary & { dependencies: { conflicts: unknown[] } };
    expect(summary.ok).toBe(true);
    expect(JSON.parse(await app.read('package.json')).dependencies['@react-native-community/netinfo']).toBe('^9.0.0');
    expect(summary.dependencies.conflicts).toEqual([
      expect.objectContaining({ name: '@react-native-community/netinfo', installed: '^9.0.0' }),
    ]);
  });
});

describe('R7: whether it can go in at all', () => {
  beforeEach(async () => {
    app = await makePluginApp();
  });

  it('refuses a plugin armemon can’t find, naming the ones it can', async () => {
    const before = await app.snapshot();
    await expect(runAddPluginFlow({ plugin: 'analytics', cwd: app.root, json: true, verify: false })).rejects.toThrow(
      '"analytics" isn\'t a plugin armemon can find',
    );
    expect(await app.snapshot()).toEqual(before);
  });
});

describe('R8: the install is part of the change', () => {
  beforeEach(async () => {
    app = await makePluginApp();
  });

  it('puts every file and the lockfile back when the install fails', async () => {
    await app.write('package-lock.json', '{"lockfileVersion": 3, "original": true}\n');
    const before = await app.snapshot();
    process.env.FAKE_NPM_EXIT = '1';
    try {
      await expect(
        captureStdout(() => runAddPluginFlow({ plugin: 'redux', cwd: app.root, json: true, verify: false })),
      ).rejects.toThrow('every change was put back');
    } finally {
      delete process.env.FAKE_NPM_EXIT;
    }
    expect(await app.snapshot()).toEqual(before);
  });
});

describe('R9 and the rest of the change', () => {
  beforeEach(async () => {
    app = await makePluginApp();
  });

  it('says what removal leaves behind', async () => {
    expect((await add('advanced-init')).ok).toBe(true);
    const summary = await remove('advanced-init');
    expect(summary.removalNotes?.join('\n')).toContain('.env');
    expect(summary.kept?.map((entry) => entry.file)).toEqual(expect.arrayContaining(['.env', '.env.example']));
    // The alias it merged into tsconfig.json comes back out; the rest of the file stays.
    expect(JSON.parse(await app.read('tsconfig.json'))).not.toHaveProperty('compilerOptions');
  });

  it('opens the app on the navigator, and on the welcome screen again after', async () => {
    const entry = await app.read('App.tsx');
    const index = await app.read('index.js');
    const babel = await app.read('babel.config.js');
    expect((await add('navigation', { answers: DRAWER })).ok).toBe(true);
    expect(await app.read('App.tsx')).toContain('<RootNavigator />');
    // A drawer needs gesture-handler imported first and reanimated's Babel plugin.
    expect(await app.read('index.js')).toMatch(/^import 'react-native-gesture-handler';\n\n/);
    expect(await app.read('babel.config.js')).toContain('react-native-reanimated/plugin');
    expect(await app.read('jest.setup.js')).toContain('react-native-reanimated');

    expect((await remove('navigation')).ok).toBe(true);
    expect(await app.read('App.tsx')).toBe(entry);
    expect(await app.read('index.js')).toBe(index);
    expect(await app.read('babel.config.js')).toBe(babel);
    expect(await app.read('jest.setup.js')).not.toContain('react-native-reanimated');
  });

  it('puts the splash markup between markers, and takes exactly that out', async () => {
    const page = await app.read('web/index.html');
    expect((await add('splash')).ok).toBe(true);
    expect(await app.read('web/index.html')).toContain('<!-- armemon:splash -->');
    expect((await remove('splash')).ok).toBe(true);
    expect(await app.read('web/index.html')).toBe(page);
  });

  it('switches the welcome screen to its themed version with the UI plugin, and back', async () => {
    const screen = await app.read('src/screens/WelcomeScreen/index.tsx');
    expect((await add('ui')).ok).toBe(true);
    expect(await app.read('src/screens/WelcomeScreen/index.tsx')).toContain('@armemon-library/ui');
    expect((await remove('ui')).ok).toBe(true);
    expect(await app.read('src/screens/WelcomeScreen/index.tsx')).toBe(screen);
    await expect(fs.access(path.join(app.root, 'armemon/ui'))).rejects.toThrow();
  });
});

describe('R10: doctor notices plugins out of step', () => {
  const BIN = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../dist/bin/armemon.js');
  const wired = async () => {
    const { spawnSync } = await import('node:child_process');
    const result = spawnSync(process.execPath, [BIN, 'doctor', '--json'], { cwd: app.root, encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '0' } });
    const report = JSON.parse(result.stdout) as { checks: Array<{ name: string; ok: boolean; detail: string }> };
    return report.checks.find((entry) => entry.name === 'plugins wired')!;
  };

  beforeEach(async () => {
    app = await makePluginApp();
    expect((await add('essentials')).ok).toBe(true);
  });

  it('agrees when plugin add wired it', async () => {
    expect(await wired()).toMatchObject({ ok: true });
  });

  it('names a plugin package missing from package.json', async () => {
    const pkg = JSON.parse(await app.read('package.json'));
    delete pkg.dependencies['@armemon-library/essentials'];
    await app.write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
    const check = await wired();
    expect(check.ok).toBe(false);
    expect(check.detail).toContain('@armemon-library/essentials is missing from package.json');
  });

  it('accepts a plugin registered under a name other than its manifest export name', async () => {
    await installAnalyticsPlugin(app, 'Analytics');
    expect((await add('analytics')).ok).toBe(true);
    expect(await app.read('armemon/runtime.generated.ts')).toContain('Analytics as plugin');
    expect(await wired()).toMatchObject({ ok: true });
  });

  it('names a plugin armemon.config lists but runtime.generated never registers', async () => {
    const file = 'armemon/runtime.generated.ts';
    await app.write(file, (await app.read(file)).replace(/import \{ EssentialsPlugin as plugin\d+ \} from '[^']+';\n/, '').replace(/plugins: \[[^\]]*\]/, 'plugins: []'));
    const check = await wired();
    expect(check.ok).toBe(false);
    expect(check.detail).toContain("essentials isn't registered in runtime.generated");
  });
});

describe('the audit: paths beyond the everyday ones', () => {
  it('--dry-run on remove writes nothing either', async () => {
    app = await makePluginApp();
    expect((await add('essentials')).ok).toBe(true);
    const before = await app.snapshot();
    const summary = await remove('essentials', { dryRun: true });
    expect(summary).toMatchObject({ ok: true, dryRun: true });
    expect(summary.deleted).toContain('armemon/essentials/index.ts');
    expect(await app.snapshot()).toEqual(before);
  });

  it('stops removing advanced-init while code imports through @/', async () => {
    app = await makePluginApp();
    expect((await add('advanced-init')).ok).toBe(true);
    await app.write('src/shared/greeting.ts', "import { format } from '@/shared/format';\n\nexport const greeting = format('hi');\n");
    await app.write('src/shared/format.ts', 'export const format = (text: string) => text;\n');
    const summary = await remove('advanced-init');
    expect(summary.ok).toBe(false);
    expect(summary.blocked).toEqual([expect.objectContaining({ rule: 'R4', file: 'src/shared/greeting.ts:1' })]);
  });

  it('--force keeps a plugin file the app still imports, and everything that file needs', async () => {
    app = await makePluginApp();
    expect((await add('ui')).ok).toBe(true);
    await app.write('src/shared/theme.ts', "export { uiConfig } from '../../armemon/ui/theme.config';\n");
    const summary = await remove('ui', { force: true });
    expect(summary.ok).toBe(true);
    expect(await app.exists('armemon/ui/theme.config.ts')).toBe(true);
    expect(summary.kept).toEqual(expect.arrayContaining([
      { file: 'armemon/ui/theme.config.ts', reason: 'still imported by src/shared/theme.ts:1' },
    ]));
    // theme.config imports the package's types, so the package stays too.
    expect(summary.dependencies?.kept.map((entry) => entry.name)).toContain('@armemon-library/ui');
  });

  it('--force past an edited navigator keeps every file it imports', async () => {
    app = await makePluginApp();
    expect((await add('navigation')).ok).toBe(true);
    const navigator = 'armemon/navigation/RootNavigator.tsx';
    await app.write(navigator, `// my change\n${await app.read(navigator)}`);
    const summary = await remove('navigation', { force: true });
    expect(summary.ok).toBe(true);

    const { moduleReferences, resolveRelativeModule } = await import('@armemon-library/cli-kit');
    const content = await app.read(navigator);
    for (const { specifier } of moduleReferences(content, navigator)) {
      if (!specifier.startsWith('.')) continue;
      expect(await resolveRelativeModule(path.join(app.root, navigator), specifier), specifier).not.toBeNull();
    }
  });

  it('works on an app that still keeps its armemon files in src/armemon', async () => {
    const { LEGACY_LAYOUT } = await import('@armemon-library/config-types');
    app = await makePluginApp({ layout: LEGACY_LAYOUT });
    const before = comparable(await app.snapshot());
    const added = await add('ui');
    expect(added.ok).toBe(true);
    expect(added.created).toContain('src/armemon/ui/theme.config.ts');
    expect(await app.read('src/armemon/runtime.generated.ts')).toContain('UiPlugin');
    expect((await remove('ui')).ok).toBe(true);
    expect(comparable(await app.snapshot())).toEqual(before);
  });

  for (const packageManager of ['pnpm', 'yarn'] as const) {
    it(`installs with ${packageManager}, and keeps its overrides in step`, async () => {
      app = await makePluginApp({ packageManager });
      const before = comparable(await app.snapshot());
      expect((await add('redux')).ok).toBe(true);
      const pkg = JSON.parse(await app.read('package.json'));
      const overrides = packageManager === 'pnpm' ? pkg.pnpm.overrides : pkg.resolutions;
      expect(overrides).toHaveProperty('@armemon-library/redux');
      expect(await app.exists(packageManager === 'pnpm' ? 'pnpm-lock.yaml' : 'yarn.lock')).toBe(true);
      expect((await remove('redux')).ok).toBe(true);
      const after = comparable(await app.snapshot());
      delete after[packageManager === 'pnpm' ? 'pnpm-lock.yaml' : 'yarn.lock'];
      expect(after).toEqual(before);
    });
  }

  it('adds and removes a plugin the app installed from npm itself', async () => {
    app = await makePluginApp();
    await installAnalyticsPlugin(app);
    const before = comparable(await app.snapshot());

    const added = await add('analytics');
    expect(added.ok, JSON.stringify(added.blocked ?? added.error)).toBe(true);
    expect(await app.read('armemon/runtime.generated.ts')).toContain("AnalyticsPlugin as plugin0 } from './analytics/index'");

    const removed = await remove('analytics');
    expect(removed.ok).toBe(true);
    // Its package came with the app, not with `plugin add` — but removing the plugin is
    // what the person asked for, and nothing imports it any more.
    expect(removed.dependencies?.removed).toEqual(['armemon-plugin-analytics']);
    const after = comparable(await app.snapshot());
    expect(JSON.parse(after['package.json']!).dependencies).not.toHaveProperty('armemon-plugin-analytics');
    delete after['package.json'];
    delete before['package.json'];
    expect(after).toEqual(before);
  });

  it('merges nothing into a tsconfig.json that is not there, and says so', async () => {
    app = await makePluginApp();
    await fs.rm(path.join(app.root, 'tsconfig.json'));
    const summary = await add('advanced-init');
    expect(summary.ok).toBe(true);
    expect(await app.exists('tsconfig.json')).toBe(false);
    expect(summary.notes?.join(' ')).toContain('no tsconfig.json');
  });

});

describe('through the binary', () => {
  const BIN = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../dist/bin/armemon.js');

  it('prints prose when not asked for JSON: what changed, and the checks', async () => {
    app = await makePluginApp();
    const { spawnSync } = await import('node:child_process');
    const added = spawnSync(process.execPath, [BIN, 'plugin', 'add', 'ui', '--all-accept', '--no-verify'], {
      cwd: app.root,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    expect(added.status, added.stderr).toBe(0);
    expect(added.stdout).toContain('Added UI Theming Kit.');
    expect(added.stdout).toContain('+ armemon/ui/theme.config.ts');

    const settings = 'armemon/ui/theme.config.ts';
    await app.write(settings, `// mine\n${await app.read(settings)}`);
    const blocked = spawnSync(process.execPath, [BIN, 'plugin', 'remove', 'ui', '--all-accept', '--no-verify'], {
      cwd: app.root,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    expect(blocked.status).toBe(1);
    expect(blocked.stderr).toContain('Nothing was changed');
    expect(`${blocked.stdout}${blocked.stderr}`).toContain(settings);
  });

  it('asks before removing, and a terminal-less run without --all-accept says how to go on', async () => {
    app = await makePluginApp();
    expect((await add('ui')).ok).toBe(true);
    const { spawnSync } = await import('node:child_process');
    const result = spawnSync(process.execPath, [BIN, 'plugin', 'remove', 'ui', '--no-verify'], {
      cwd: app.root,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0', CI: 'true' },
      input: '',
    });
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toMatch(/--all-accept/);
    expect(await app.exists('armemon/ui/index.ts')).toBe(true);
  });

  it('answers an unknown option with JSON under --json', async () => {
    app = await makePluginApp();
    const { spawnSync } = await import('node:child_process');
    const result = spawnSync(process.execPath, [BIN, 'plugin', 'add', 'ui', '--bogus', '--json'], { cwd: app.root, encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ schemaVersion: 1, ok: false });
  });

  it('puts every file back when Ctrl-C lands during the install, and exits 130', async () => {
    app = await makePluginApp();
    await app.write('package-lock.json', 'the original lockfile\n');
    const before = await app.snapshot();
    const { spawn } = await import('node:child_process');
    const child = spawn(process.execPath, [BIN, 'plugin', 'add', 'redux', '--json', '--no-verify'], {
      cwd: app.root,
      env: { ...process.env, FAKE_NPM_SLEEP: '4' },
    });
    let stdout = '';
    child.stdout.on('data', (chunk) => (stdout += String(chunk)));
    let stderr = '';
    let interrupted = false;
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
      // Once the install has started, interrupt it once, the way a terminal does. (A
      // second Ctrl-C quits on the spot, by design.)
      if (!interrupted && stderr.includes('Installing packages')) {
        interrupted = true;
        child.kill('SIGINT');
      }
    });
    const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));
    expect(code, stderr).toBe(130);
    expect(JSON.parse(stdout)).toMatchObject({ ok: false });
    expect(await app.snapshot()).toEqual(before);
  }, 30_000);
});

describe('armemon add <platform> keeps plugin files in line', () => {
  it('writes what a plugin needs on web, updates what it writes differently, and removal still works', async () => {
    const { runAddPlatformFlow } = await import('../dist/index.js');
    app = await makePluginApp({ platforms: ['ios', 'android'] });
    expect((await add('splash')).ok).toBe(true);
    const settings = 'armemon/splash/splash.config.ts';
    const withoutWeb = await app.read(settings);
    expect(await app.exists('armemon/splash/hide.web.ts')).toBe(false);

    resetCliState();
    const out = await captureStdout(() => runAddPlatformFlow({ platform: 'web', cwd: app.root, json: true, verify: false }));
    const summary = JSON.parse(out) as { ok: boolean; notes: string[] };
    expect(summary.ok).toBe(true);
    // The web bundle needs its own hide, or it resolves the native one.
    expect(await app.exists('armemon/splash/hide.web.ts')).toBe(true);
    expect(await app.read(settings)).not.toBe(withoutWeb);
    expect(summary.notes.join(' ')).toContain('armemon/splash/hide.web.ts');
    expect(await app.read('web/index.html')).toContain('<!-- armemon:splash -->');

    // Untouched by anyone, so nothing blocks taking the plugin out again.
    const removed = await remove('splash');
    expect(removed.ok, JSON.stringify(removed.blocked)).toBe(true);
    expect(await app.exists('armemon/splash/hide.web.ts')).toBe(false);
    expect(await app.read('web/index.html')).not.toContain('armemon:splash');
  });

  it('leaves a plugin file with your changes as it is, and says so', async () => {
    const { runAddPlatformFlow } = await import('../dist/index.js');
    app = await makePluginApp({ platforms: ['ios', 'android'] });
    expect((await add('splash')).ok).toBe(true);
    const settings = 'armemon/splash/splash.config.ts';
    const edited = (await app.read(settings)).replace("backgroundColor: '#FFFFFF'", "backgroundColor: '#000000'");
    await app.write(settings, edited);

    resetCliState();
    const out = await captureStdout(() => runAddPlatformFlow({ platform: 'web', cwd: app.root, json: true, verify: false }));
    const summary = JSON.parse(out) as { ok: boolean; notes: string[] };
    expect(await app.read(settings)).toBe(edited);
    expect(summary.notes.join(' ')).toContain(`have your changes, so they were left as they are: ${settings}`);
  });
});

describe('native projects that still use a plugin', () => {
  it('stop the removal, and --force keeps the package the native build needs', async () => {
    app = await makePluginApp({ platforms: ['ios', 'android'] });
    expect((await add('splash')).ok).toBe(true);
    // What `react-native-bootsplash generate` leaves in the Android project.
    await app.write(
      'android/app/src/main/res/values/styles.xml',
      '<resources>\n    <style name="BootTheme" parent="Theme.BootSplash">\n    </style>\n</resources>\n',
    );
    await app.write('android/app/build/intermediates/merged.xml', 'Theme.BootSplash — build output is never read');

    const blocked = await remove('splash');
    expect(blocked.ok).toBe(false);
    expect(blocked.blocked).toEqual([
      expect.objectContaining({ rule: 'R4', file: 'android/app/src/main/res/values/styles.xml:2' }),
    ]);

    const forced = await remove('splash', { force: true });
    expect(forced.ok).toBe(true);
    expect(forced.dependencies?.kept).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'react-native-bootsplash' })]));
    expect(JSON.parse(await app.read('package.json')).dependencies).toHaveProperty('react-native-bootsplash');
  });

  it("don't matter once reverted", async () => {
    app = await makePluginApp({ platforms: ['ios', 'android'] });
    expect((await add('splash')).ok).toBe(true);
    await app.write('android/app/src/main/res/values/styles.xml', '<resources>\n</resources>\n');
    const removed = await remove('splash');
    expect(removed.ok).toBe(true);
    expect(removed.dependencies?.removed).toContain('react-native-bootsplash');
  });
});
