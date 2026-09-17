/**
 * FILE: renameSlice.test.ts
 * PATH: packages/cli-armemon/test/renameSlice.test.ts
 *
 * WHAT: `armemon rename-slice` against a real app.
 * WHY:  A slice's name lives in five places, and the one a hand-rename misses is the
 *       `name` field — which moves state.cart to state.basket while every action goes
 *       on dispatching `cart/…`. So the checks here are about all five agreeing
 *       afterwards, and about the one thing armemon deliberately does NOT rewrite:
 *       action types written as strings, which are reported instead.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runRenameSliceFlow } from '../dist/index.js';
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

const rename = (options: Record<string, unknown> = {}) =>
  runRenameSliceFlow({
    cwd: app.root,
    allAccept: true,
    verify: false,
    from: 'counter',
    to: 'tally',
    ...options,
  });

describe('rename-slice', () => {
  // [from] and [to] are optional so a person can be asked for them, as create-slice
  // and remove-slice ask. With nobody to ask, it says what to type instead.
  it('asks for nothing when it may not ask, and says what to type', async () => {
    await scaffoldReduxStore(app);
    await expect(rename({ to: undefined })).rejects.toMatchObject({
      message: 'Name the slice and what to call it.',
      hint: 'e.g. armemon rename-slice cart basket',
    });
  });

  it('moves the file and renames what is inside it', async () => {
    await scaffoldReduxStore(app);
    await rename();

    expect(await app.exists('src/store/slices/counterSlice.ts')).toBe(false);
    const slice = await app.read('src/store/slices/tallySlice.ts');
    expect(slice).toContain('export const tallySlice');
    expect(slice).toContain("name: 'tally'");
  });

  it('renames the store entry, the binding and the import path', async () => {
    await scaffoldReduxStore(app);
    await rename();

    const store = await app.read(STORE);
    expect(store).toContain('tally: tallySlice,');
    expect(store).toContain("import { tallySlice } from '../../src/store/slices/tallySlice';");
    expect(store).not.toContain('counterSlice');
  });

  it('follows the rename into a file that imports the slice', async () => {
    await scaffoldReduxStore(app);
    await app.write(
      'src/screens/HomeScreen/index.tsx',
      "import { counterSlice } from '../../store/slices/counterSlice';\nexport default function HomeScreen() { return counterSlice.name; }\n",
    );

    await rename();

    const screen = await app.read('src/screens/HomeScreen/index.tsx');
    expect(screen).toContain("import { tallySlice } from '../../store/slices/tallySlice';");
    expect(screen).toContain('return tallySlice.name;');
  });

  /** The thing armemon deliberately will not rewrite, because it is just text. */
  it('names the files that still dispatch the old action type', async () => {
    await scaffoldReduxStore(app);
    await app.write(
      'src/screens/HomeScreen/index.tsx',
      "export default function HomeScreen(dispatch: any) { return dispatch({ type: 'counter/increment' }); }\n",
    );

    const json = await captureStdout(() => rename({ json: true }));
    expect(JSON.parse(json).dispatchers).toContain('src/screens/HomeScreen/index.tsx');
  });

  it('refuses when the new name is already taken', async () => {
    await scaffoldReduxStore(app);
    await app.write('src/store/slices/tallySlice.ts', 'export const tallySlice = {};\n');

    await expect(rename()).rejects.toMatchObject({
      message: expect.stringContaining('already exists'),
    });
  });

  it('refuses to rename a slice to itself', async () => {
    await scaffoldReduxStore(app);
    await expect(rename({ to: 'counterSlice' })).rejects.toMatchObject({
      message: expect.stringContaining('the same slice'),
    });
  });

  it('says so when there is no such slice', async () => {
    await scaffoldReduxStore(app);
    await expect(rename({ from: 'nothing' })).rejects.toMatchObject({
      message: expect.stringContaining("There's no nothing slice"),
    });
  });

  it('--dry-run changes nothing', async () => {
    await scaffoldReduxStore(app);
    const before = await app.read(STORE);

    await rename({ dryRun: true });

    expect(await app.read(STORE)).toBe(before);
    expect(await app.exists('src/store/slices/counterSlice.ts')).toBe(true);
    expect(await app.exists('src/store/slices/tallySlice.ts')).toBe(false);
  });

  it('reports itself as JSON', async () => {
    await scaffoldReduxStore(app);
    const json = await captureStdout(() => rename({ json: true }));

    expect(JSON.parse(json)).toMatchObject({
      ok: true,
      from: 'counter',
      to: 'tally',
      file: 'src/store/slices/tallySlice.ts',
    });
  });

  it('round-trips back to where it started', async () => {
    await scaffoldReduxStore(app);
    const before = await app.read(STORE);

    await rename();
    await runRenameSliceFlow({ cwd: app.root, allAccept: true, verify: false, from: 'tally', to: 'counter' });

    expect(await app.read(STORE)).toBe(before);
    expect(await app.exists('src/store/slices/counterSlice.ts')).toBe(true);
  });
});
