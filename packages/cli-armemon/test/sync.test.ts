/**
 * FILE: sync.test.ts
 * PATH: packages/cli-armemon/test/sync.test.ts
 *
 * WHAT: `armemon sync` — re-aligning the managed zone, and migrating an app that
 *       still keeps it under src/.
 * WHY:  This is the most destructive command in the CLI: it renames a folder and
 *       rewrites imports across the whole project in one transaction. Everything
 *       else can be re-run; this cannot be un-run. The cases that matter are the
 *       ones where a mistake is silent — a dry run that moved something anyway, an
 *       import rewritten to a path that resolves to nothing, or a rollback that
 *       deletes a file instead of restoring it.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runSyncFlow } from '../dist/index.js';
import {
  LEGACY_NAV,
  NAV,
  captureStdout,
  makeApp,
  resetCliState,
  scaffoldLegacyNavigation,
  scaffoldNavigation,
  type TestApp,
} from './support/screenApps';

let app: TestApp;

beforeEach(async () => {
  app = await makeApp();
  resetCliState();
});
afterEach(async () => {
  await app.remove();
  resetCliState();
});

const sync = (options: Record<string, unknown> = {}) =>
  runSyncFlow({ cwd: app.root, allAccept: true, verify: false, ...options });

/** Every file in the app, by app-relative path, for byte-for-byte comparison. */
async function snapshot(root = app.root, prefix = ''): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    const key = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(out, await snapshot(full, key));
    else out[key] = await fs.readFile(full, 'utf8');
  }
  return out;
}

describe('sync, migrating a legacy app', () => {
  it('moves the managed zone to the app root', async () => {
    await scaffoldLegacyNavigation(app);
    await sync();

    expect(await app.exists(`${NAV}/RootNavigator.tsx`)).toBe(true);
    expect(await app.exists('src/armemon')).toBe(false);
  });

  it('lengthens the reach out of the moved folder', async () => {
    await scaffoldLegacyNavigation(app);
    await sync();

    // armemon/navigation/ -> src/screens/ is one level further than it used to be.
    expect(await app.read(`${NAV}/RootNavigator.tsx`)).toContain(
      "from '../../src/screens/HomeScreen'",
    );
    // A sibling moves with the file, so it must not change at all.
    expect(await app.read(`${NAV}/RootNavigator.tsx`)).toContain("from './types'");
  });

  it('lengthens the reach into the moved folder from a file that stayed put', async () => {
    await scaffoldLegacyNavigation(app);
    await sync();

    expect(await app.read('src/screens/HomeScreen/index.tsx')).toContain(
      "from '../../../armemon/navigation/types'",
    );
  });

  it('shortens the App entry at the app root', async () => {
    await scaffoldLegacyNavigation(app);
    await sync();

    const entry = await app.read('App.tsx');
    expect(entry).toContain("import './armemon/runtime.generated';");
    expect(entry).toContain("from './armemon/navigation/RootNavigator'");
    expect(entry).not.toContain('src/armemon');
  });

  /**
   * The assertions above check the text. This checks the thing that actually matters:
   * that every rewritten specifier names a file that is really there afterwards.
   */
  it('leaves every relative import resolving to a file that exists', async () => {
    await scaffoldLegacyNavigation(app);
    await sync();

    const files = [
      `${NAV}/RootNavigator.tsx`,
      'src/screens/HomeScreen/index.tsx',
      'App.tsx',
    ];
    for (const file of files) {
      const content = await app.read(file);
      for (const [, spec] of content.matchAll(/(?:from|import)\s+['"](\.[^'"]*)['"]/g)) {
        const base = path.resolve(path.dirname(path.join(app.root, file)), spec);
        const found = await Promise.all(
          ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx'].map((ext) =>
            fs.access(`${base}${ext}`).then(() => true, () => false),
          ),
        );
        expect(found.some(Boolean), `${file} -> ${spec}`).toBe(true);
      }
    }
  });

  // Everything that names the old folder: a test's jest.mock path, an import through
  // the `@/` alias (which can't reach the new folder, outside src/), and a config
  // file sync won't edit but has to point out.
  it('follows the move into tests, alias imports and config files', async () => {
    await scaffoldLegacyNavigation(app);
    await app.write(
      '__tests__/RootNavigator.test.tsx',
      "jest.mock('../src/armemon/navigation/types');\nimport RootNavigator from '../src/armemon/navigation/RootNavigator';\n",
    );
    await app.write(
      'src/screens/HomeScreen/useRoutes.ts',
      "import type { RootStackParamList } from '@/armemon/navigation/types';\nexport type Routes = RootStackParamList;\n",
    );
    await app.write('tsconfig.json', '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }\n');
    await app.write('jest.config.js', "module.exports = { roots: ['<rootDir>/src/armemon'] };\n");

    const summary = JSON.parse(await captureStdout(() => sync({ json: true }))) as {
      unresolved: unknown[];
      configMentions: string[];
    };

    const test = await app.read('__tests__/RootNavigator.test.tsx');
    expect(test).toContain("jest.mock('../armemon/navigation/types');");
    expect(test).toContain("from '../armemon/navigation/RootNavigator'");
    expect(await app.read('src/screens/HomeScreen/useRoutes.ts')).toContain(
      "from '../../../armemon/navigation/types'",
    );
    expect(summary.unresolved).toEqual([]);
    expect(summary.configMentions).toEqual(['jest.config.js']);
    expect(await app.read('jest.config.js')).toContain('src/armemon');
  });

  it('refuses when both layouts exist rather than picking one', async () => {
    await scaffoldLegacyNavigation(app);
    await app.write('armemon/runtime.generated.ts', 'export const registered = true;\n');

    await expect(sync()).rejects.toMatchObject({
      message: expect.stringContaining('both'),
    });
    expect(await app.exists(`${LEGACY_NAV}/RootNavigator.tsx`)).toBe(true);
  });

  it('--dry-run reports the move and changes nothing on disk', async () => {
    await scaffoldLegacyNavigation(app);
    const before = await snapshot();

    await sync({ dryRun: true });

    expect(await snapshot()).toEqual(before);
    expect(await app.exists(`${LEGACY_NAV}/RootNavigator.tsx`)).toBe(true);
    expect(await app.exists('armemon')).toBe(false);
  });

  it('skips a file it cannot parse, and still migrates the rest', async () => {
    await scaffoldLegacyNavigation(app);
    await app.write('src/screens/Broken/index.tsx', 'export default function ( {{{\n');

    const json = await captureStdout(() => sync({ json: true }));
    const summary = JSON.parse(json);

    expect(summary.unparsable).toContain('src/screens/Broken/index.tsx');
    expect(summary.ok).toBe(false);
    // The rest of the app still moved.
    expect(await app.exists(`${NAV}/RootNavigator.tsx`)).toBe(true);
  });

  it('reports the move as JSON for a script', async () => {
    await scaffoldLegacyNavigation(app);
    const json = await captureStdout(() => sync({ json: true }));

    expect(JSON.parse(json)).toMatchObject({
      ok: true,
      moved: { from: 'src/armemon', to: 'armemon' },
    });
  });
});

describe('sync, on an app already in the current layout', () => {
  it('says there is nothing to change', async () => {
    await scaffoldNavigation(app);
    const json = await captureStdout(() => sync({ json: true }));

    expect(JSON.parse(json)).toMatchObject({ ok: true, moved: null, changed: 0 });
  });

  it('re-aligns a managed file that was hand-edited, and leaves src/ alone', async () => {
    await scaffoldNavigation(app);

    // Valid code, just not the shape armemon writes.
    const messy = (await app.read(`${NAV}/types.ts`)).replace(/;$/gm, '');
    await app.write(`${NAV}/types.ts`, messy);

    const ownCode = "const  x   =  1\nexport default x\n";
    await app.write('src/screens/HomeScreen/messy.ts', ownCode);

    await sync();

    expect(await app.read(`${NAV}/types.ts`)).toContain(';');
    // The author's own file is not armemon's to reformat.
    expect(await app.read('src/screens/HomeScreen/messy.ts')).toBe(ownCode);
  });
});

describe('sync, the in-app guide', () => {
  const REFERENCE = '\n---\n\n# Every armemon command\n\n- `armemon sync` — re-align\n';

  it('refreshes the guide with the command reference', async () => {
    await scaffoldNavigation(app);
    await sync({ commandReference: REFERENCE });

    const guide = await app.read('armemon/README.md');
    // The zone explanation and the generated reference, in one file.
    expect(guide).toContain('Your armemon app guide');
    expect(guide).toContain('Every armemon command');
  });

  it('leaves the guide alone when no reference was built', async () => {
    await scaffoldNavigation(app);
    await sync();

    expect(await app.exists('armemon/README.md')).toBe(false);
  });

  it('rewrites a guide that has gone stale', async () => {
    await scaffoldNavigation(app);
    await app.write('armemon/README.md', '# armemon/\n\nold, from an older CLI\n');

    await sync({ commandReference: REFERENCE });

    const guide = await app.read('armemon/README.md');
    expect(guide).toContain('Every armemon command');
    expect(guide).not.toContain('from an older CLI');
  });

  /**
   * The migration case: commit() moves the folder before it writes, so the old guide
   * is already at the new path by the time this is staged. Staged wrongly, a failure
   * would delete it rather than restore it.
   */
  it('replaces a legacy guide carried up by the move, rather than losing it', async () => {
    await scaffoldLegacyNavigation(app);
    await app.write('src/armemon/README.md', '# src/armemon/\n\nold guide\n');

    await sync({ commandReference: REFERENCE });

    expect(await app.exists('src/armemon')).toBe(false);
    const guide = await app.read('armemon/README.md');
    expect(guide).toContain('Every armemon command');
    expect(guide).toContain('Your armemon app guide');
  });
});
