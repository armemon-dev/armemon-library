/**
 * FILE: removeSlice.test.ts
 * PATH: packages/cli-armemon/test/removeSlice.test.ts
 *
 * WHAT: `armemon remove-slice` against a real app.
 * WHY:  Removal has two ways to go quietly wrong: deleting the file while something
 *       still imports it (a build that breaks somewhere else), and unregistering
 *       without deleting (a file nothing loads). The round-trip case is the strongest
 *       single check — create then remove has to leave the store byte-for-byte as it
 *       started, or one of the two commands is doing something the other doesn't undo.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCreateSliceFlow, runRemoveSliceFlow } from '../dist/index.js';
import {
  captureStdout,
  makeApp,
  resetCliState,
  scaffoldReduxStore,
  type TestApp,
} from './support/screenApps';

const STORE = 'armemon/redux/store.config.ts';

let app: TestApp;

beforeEach(async () => {
  app = await makeApp();
  resetCliState();
});
afterEach(async () => {
  await app.remove();
  resetCliState();
});

const remove = (options: Record<string, unknown> = {}) =>
  runRemoveSliceFlow({ cwd: app.root, allAccept: true, verify: false, name: 'counter', ...options });

const create = (options: Record<string, unknown> = {}) =>
  runCreateSliceFlow({ cwd: app.root, allAccept: true, verify: false, name: 'cart', ...options });

describe('remove-slice', () => {
  it('unregisters it and deletes the file', async () => {
    await scaffoldReduxStore(app);
    await remove();

    const store = await app.read(STORE);
    expect(store).not.toContain('counter: counterSlice,');
    expect(store).not.toContain('import { counterSlice }');
    expect(await app.exists('src/store/slices/counterSlice.ts')).toBe(false);
  });

  /** The strongest check available: the two commands have to be exact inverses. */
  it('undoes create-slice exactly', async () => {
    await scaffoldReduxStore(app);
    const before = await app.read(STORE);

    await create();
    expect(await app.read(STORE)).not.toBe(before);

    await runRemoveSliceFlow({ cwd: app.root, allAccept: true, verify: false, name: 'cart' });
    expect(await app.read(STORE)).toBe(before);
  });

  it('--keep-files unregisters without deleting', async () => {
    await scaffoldReduxStore(app);
    await remove({ keepFiles: true });

    expect(await app.read(STORE)).not.toContain('counter: counterSlice,');
    expect(await app.exists('src/store/slices/counterSlice.ts')).toBe(true);
  });

  it('refuses while another file still imports it', async () => {
    await scaffoldReduxStore(app);
    await app.write(
      'src/screens/HomeScreen/index.tsx',
      "import { counterSlice } from '../../store/slices/counterSlice';\nexport default function HomeScreen() { return counterSlice; }\n",
    );

    await expect(remove()).rejects.toMatchObject({
      message: expect.stringContaining('src/screens/HomeScreen/index.tsx'),
    });

    // Nothing was touched.
    expect(await app.exists('src/store/slices/counterSlice.ts')).toBe(true);
    expect(await app.read(STORE)).toContain('counter: counterSlice,');
  });

  it('--force removes it anyway and says what will break', async () => {
    await scaffoldReduxStore(app);
    await app.write(
      'src/screens/HomeScreen/index.tsx',
      "import { counterSlice } from '../../store/slices/counterSlice';\nexport default function HomeScreen() { return counterSlice; }\n",
    );

    await remove({ force: true });
    expect(await app.exists('src/store/slices/counterSlice.ts')).toBe(false);
  });

  it('says so when there is no such slice', async () => {
    await scaffoldReduxStore(app);
    await expect(remove({ name: 'nothing' })).rejects.toMatchObject({
      message: expect.stringContaining("There's no nothing slice"),
    });
  });

  it('--dry-run changes nothing', async () => {
    await scaffoldReduxStore(app);
    const before = await app.read(STORE);

    await remove({ dryRun: true });

    expect(await app.read(STORE)).toBe(before);
    expect(await app.exists('src/store/slices/counterSlice.ts')).toBe(true);
  });

  it('reports itself as JSON', async () => {
    await scaffoldReduxStore(app);
    const json = await captureStdout(() => remove({ json: true }));

    expect(JSON.parse(json)).toMatchObject({
      ok: true,
      name: 'counter',
      deleted: true,
      referencedBy: [],
    });
  });
});
