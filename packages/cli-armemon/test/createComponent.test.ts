/**
 * FILE: createComponent.test.ts
 * PATH: packages/cli-armemon/test/createComponent.test.ts
 *
 * WHAT: `armemon create-component` and `armemon create-hook` against a real app.
 * WHY:  These two are defined as much by what they DON'T do as by what they do: one
 *       file appears and nothing else in the app changes — no import added, no
 *       managed file touched. That restraint is the feature, so it is what these
 *       check most carefully.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCreateComponentFlow } from '../dist/index.js';
import {
  captureStdout,
  makeApp,
  resetCliState,
  scaffoldNavigation,
  writeConfig,
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

const run = (options: Record<string, unknown> = {}) =>
  runCreateComponentFlow({
    cwd: app.root,
    allAccept: true,
    verify: false,
    kind: 'component',
    name: 'OrderRow',
    shared: true,
    ...options,
  });

/** Every file in the app, by app-relative path — for proving nothing else moved. */
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

describe('create-component', () => {
  it('writes a shared component', async () => {
    await writeConfig(app);
    await run();

    const file = await app.read('src/shared/components/OrderRow.tsx');
    expect(file).toContain('export default function OrderRow(');
  });

  it("writes into a screen's own folder when asked", async () => {
    await writeConfig(app);
    await app.write('src/screens/OrderScreen/index.tsx', 'export default function OrderScreen() { return null; }\n');

    await run({ shared: false, screen: 'Order' });

    expect(await app.exists('src/screens/OrderScreen/components/OrderRow.tsx')).toBe(true);
  });

  /** The whole point of the command: it creates a file and wires nothing. */
  it('changes nothing else in the app', async () => {
    await scaffoldNavigation(app);
    const before = await snapshot();

    await run();

    const after = await snapshot();
    const added = Object.keys(after).filter((file) => !(file in before));
    expect(added).toEqual(['src/shared/components/OrderRow.tsx']);

    // Every pre-existing file is byte-for-byte what it was — no import was added
    // anywhere, and no managed file was touched.
    for (const file of Object.keys(before)) expect(after[file]).toBe(before[file]);
  });

  it('refuses a name JSX would read as an HTML tag', async () => {
    await writeConfig(app);
    await expect(run({ name: 'orderRow' })).rejects.toMatchObject({
      message: expect.stringContaining('not a usable component name'),
    });
  });

  it('refuses a screen the app does not have, and says which it has', async () => {
    await writeConfig(app);
    await app.write('src/screens/HomeScreen/index.tsx', 'export default function HomeScreen() { return null; }\n');

    await expect(run({ shared: false, screen: 'Nope' })).rejects.toMatchObject({
      hint: expect.stringContaining('Home'),
    });
  });

  it('refuses --shared and --screen together', async () => {
    await writeConfig(app);
    await expect(run({ screen: 'Order' })).rejects.toMatchObject({
      message: expect.stringContaining('contradict'),
    });
  });

  it('refuses an existing file unless forced', async () => {
    await writeConfig(app);
    await app.write('src/shared/components/OrderRow.tsx', 'export default function OrderRow() { return null; }\n');

    await expect(run()).rejects.toMatchObject({ message: expect.stringContaining('already exists') });

    await run({ force: true });
    expect(await app.read('src/shared/components/OrderRow.tsx')).toContain('StyleSheet');
  });

  it('--dry-run writes nothing', async () => {
    await writeConfig(app);
    await run({ dryRun: true });
    expect(await app.exists('src/shared/components/OrderRow.tsx')).toBe(false);
  });

  it('reports itself as JSON', async () => {
    await writeConfig(app);
    const json = await captureStdout(() => run({ json: true }));

    expect(JSON.parse(json)).toMatchObject({
      ok: true,
      kind: 'component',
      name: 'OrderRow',
      file: 'src/shared/components/OrderRow.tsx',
      folder: 'src/shared/components',
    });
  });

  it('follows the app language', async () => {
    await writeConfig(app, 'javascript');
    await run();

    expect(await app.exists('src/shared/components/OrderRow.jsx')).toBe(true);
    expect(await app.read('src/shared/components/OrderRow.jsx')).not.toContain('interface');
  });
});

describe('create-hook', () => {
  const hook = (options: Record<string, unknown> = {}) =>
    run({ kind: 'hook', name: 'useOrderTotals', ...options });

  it('writes a shared hook', async () => {
    await writeConfig(app);
    await hook();

    expect(await app.read('src/shared/hooks/useOrderTotals.ts')).toContain(
      'export function useOrderTotals()',
    );
  });

  it('refuses a name React would not apply the rules of hooks to', async () => {
    await writeConfig(app);
    await expect(hook({ name: 'orderTotals' })).rejects.toMatchObject({
      message: expect.stringContaining('not a usable hook name'),
    });
  });

  it("writes into a screen's hooks folder when asked", async () => {
    await writeConfig(app);
    await app.write('src/screens/OrderScreen/index.tsx', 'export default function OrderScreen() { return null; }\n');

    await hook({ shared: false, screen: 'OrderScreen' });

    expect(await app.exists('src/screens/OrderScreen/hooks/useOrderTotals.ts')).toBe(true);
  });
});
