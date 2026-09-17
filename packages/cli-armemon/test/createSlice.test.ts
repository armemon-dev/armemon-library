/**
 * FILE: createSlice.test.ts
 * PATH: packages/cli-armemon/test/createSlice.test.ts
 *
 * WHAT: `armemon create-slice` against a real app on disk.
 * WHY:  The failure this command exists to prevent is silent: a slice file that was
 *       written but never registered gives you an app that compiles and whose
 *       `state.cart` is undefined. So these check both halves landed together — and
 *       that neither lands when the run is refused or is a dry run.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCreateSliceFlow } from '../dist/index.js';
import {
  captureStdout,
  makeApp,
  resetCliState,
  scaffoldReduxStore,
  writeConfig,
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

const create = (options: Record<string, unknown> = {}) =>
  runCreateSliceFlow({ cwd: app.root, allAccept: true, verify: false, name: 'cart', ...options });

describe('create-slice', () => {
  it('writes the slice file and registers it in one run', async () => {
    await scaffoldReduxStore(app);
    await create();

    expect(await app.exists('src/store/slices/cartSlice.ts')).toBe(true);

    const store = await app.read(STORE);
    expect(store).toContain("import { cartSlice } from '../../src/store/slices/cartSlice';");
    expect(store).toContain('cart: cartSlice,');
  });

  it('keeps the slice that was already registered', async () => {
    await scaffoldReduxStore(app);
    await create();
    expect(await app.read(STORE)).toContain('counter: counterSlice,');
  });

  /**
   * The store config ships with `//   cart: cartSlice,` in a comment. A patcher that
   * matched lines would call this already done and write nothing.
   */
  it('is not fooled by the commented-out example of the same name', async () => {
    await scaffoldReduxStore(app);
    await create();

    const slices = (await app.read(STORE)).slice((await app.read(STORE)).indexOf('slices: {'));
    expect(slices).toContain('cart: cartSlice,');
  });

  it('names the slice from anything reasonable', async () => {
    await scaffoldReduxStore(app);
    await create({ name: 'CartSlice' });

    expect(await app.exists('src/store/slices/cartSlice.ts')).toBe(true);
    expect(await app.read(STORE)).toContain('cart: cartSlice,');
  });

  it('--no-register writes the file and leaves the store alone', async () => {
    await scaffoldReduxStore(app);
    const before = await app.read(STORE);

    await create({ register: false });

    expect(await app.exists('src/store/slices/cartSlice.ts')).toBe(true);
    expect(await app.read(STORE)).toBe(before);
  });

  it('refuses when the slice file already exists, unless forced', async () => {
    await scaffoldReduxStore(app);
    await app.write('src/store/slices/cartSlice.ts', 'export const cartSlice = { mine: true };\n');

    await expect(create()).rejects.toMatchObject({ message: expect.stringContaining('already exists') });
    expect(await app.read('src/store/slices/cartSlice.ts')).toContain('mine: true');

    await create({ force: true });
    expect(await app.read('src/store/slices/cartSlice.ts')).toContain('export const cartSlice = {');
  });

  it('says so when the app has no Redux store to register into', async () => {
    await writeConfig(app);

    await expect(create()).rejects.toMatchObject({
      message: expect.stringContaining('Redux'),
      // `armemon add` takes platforms only; a hint naming `add redux` was a dead end.
      hint: expect.not.stringContaining('armemon add'),
    });
    expect(await app.exists('src/store/slices/cartSlice.ts')).toBe(false);
  });

  it('--dry-run writes nothing at all', async () => {
    await scaffoldReduxStore(app);
    const before = await app.read(STORE);

    await create({ dryRun: true });

    expect(await app.exists('src/store/slices/cartSlice.ts')).toBe(false);
    expect(await app.read(STORE)).toBe(before);
  });

  it('reports itself as JSON for a script', async () => {
    await scaffoldReduxStore(app);
    const json = await captureStdout(() => create({ json: true }));

    expect(JSON.parse(json)).toMatchObject({
      ok: true,
      name: 'cart',
      file: 'src/store/slices/cartSlice.ts',
      exportName: 'cartSlice',
      registered: true,
    });
  });

  it('follows the app language into the file it writes', async () => {
    await scaffoldReduxStore(app, 'javascript');
    await create();

    expect(await app.exists('src/store/slices/cartSlice.js')).toBe(true);
    expect(await app.exists('src/store/slices/cartSlice.ts')).toBe(false);
    expect(await app.read('armemon/redux/store.config.js')).toContain('cart: cartSlice,');
  });

  it('leaves nothing behind when the store edit cannot be made', async () => {
    await scaffoldReduxStore(app);
    // Valid enough to read, but there is no slices object to add to.
    await app.write(STORE, 'export const reduxConfig = { persist: { enabled: false } };\n');

    await expect(create()).rejects.toMatchObject({
      message: expect.stringContaining("Can't register cart"),
    });

    const store = await app.read(STORE);
    expect(store).not.toContain('cart: cartSlice');
    expect(store).not.toContain('import { cartSlice }');
    // Neither half lands: a slice file with no store entry is the silent
    // half-done state this command exists to prevent.
    expect(await app.exists('src/store/slices/cartSlice.ts')).toBe(false);
  });

  it('re-aligns a hand-edited store config before editing it', async () => {
    await scaffoldReduxStore(app);
    await app.write(STORE, (await app.read(STORE)).replace(/;$/gm, ''));

    await create();

    const store = await app.read(STORE);
    expect(store).toContain('cart: cartSlice,');
    // Re-alignment put the semicolons back while it was in there.
    expect(store).toContain("from '../../src/store/slices/counterSlice';");
  });
});

describe('create-slice, undo safety', () => {
  it('does not write the slice file when the store config refuses the edit', async () => {
    await scaffoldReduxStore(app);
    await app.write(STORE, 'export const reduxConfig = {{{\n');

    await create().catch(() => undefined);

    // The file is created in the same commit as the store edit, so a refusal that
    // throws before commit must leave the author's zone untouched too.
    expect(await app.exists('src/store/slices/cartSlice.ts')).toBe(false);
  });
});

describe('create-slice, file contents', () => {
  it('writes a slice whose header names the store config that loads it', async () => {
    await scaffoldReduxStore(app);
    await create();

    const slice = await app.read('src/store/slices/cartSlice.ts');
    expect(slice).toContain('armemon/redux/store.config.ts');
    expect(slice).toContain("name: 'cart',");
    expect(slice).toContain('export const cartSlice = {');
  });

  it('puts the slice in the author zone, never in the managed one', async () => {
    await scaffoldReduxStore(app);
    await create();

    const managed = await fs.readdir(path.join(app.root, 'armemon', 'redux'));
    expect(managed).not.toContain('cartSlice.ts');
  });
});
