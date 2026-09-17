/**
 * FILE: javascriptApps.test.ts
 * PATH: packages/cli-armemon/test/javascriptApps.test.ts
 *
 * WHAT: Every command that writes source files, run against a JavaScript app, leaves
 *       only JavaScript behind.
 * WHY:  init converts its output centrally, so the wizards were covered. The commands
 *       people run afterwards build their own files, and two of them — create-slice
 *       and create-hook — wrote `null as unknown`, typed reducer parameters and
 *       `useState<unknown>` into .js files. Metro rejects the first two; the generic
 *       parses as comparisons and throws at runtime. The syntax check that should have
 *       said so couldn't see types at all, so nothing failed.
 * HOW:  Runs each command against a real JavaScript app on disk, then reads back
 *       every file in the app — not just the one the command reports — and checks it
 *       with the same guard the wizard suites use.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { javaScriptSyntaxErrors } from '@armemon-library/cli-kit';
import {
  runCreateComponentFlow,
  runCreateScreenFlow,
  runCreateSliceFlow,
} from '../dist/index.js';
import {
  makeApp,
  resetCliState,
  scaffoldNavigation,
  scaffoldReduxStore,
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

async function sourceFiles(dir = app.root): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await sourceFiles(full)));
    else if (/\.[jt]sx?$/.test(entry.name)) found.push(path.relative(app.root, full));
  }
  return found;
}

/** Every source file in the app is JavaScript, by name and by content. */
async function expectOnlyJavaScript(): Promise<void> {
  const files = await sourceFiles();
  expect(files.filter((file) => /\.tsx?$/.test(file))).toEqual([]);

  for (const file of files) {
    const content = await app.read(file);
    const errors = javaScriptSyntaxErrors(content, file);
    expect(errors, `${file}: ${errors.join('; ')}`).toEqual([]);

    // A header naming cartSlice.ts in cartSlice.js sends the reader to a file that
    // doesn't exist.
    const named = content.match(/^ \* FILE: (.+)$/m)?.[1];
    if (named) expect(named, `${file}'s FILE header`).toBe(path.basename(file));
  }
}

const common = { cwd: '', allAccept: true, verify: false };

describe('in a JavaScript app', () => {
  it('create-screen writes JavaScript', async () => {
    await scaffoldNavigation(app, {}, 'javascript');
    await runCreateScreenFlow({ ...common, cwd: app.root, name: 'Order', full: true } as never);
    await expectOnlyJavaScript();
  });

  it('create-screen with typed params and a link writes JavaScript', async () => {
    await scaffoldNavigation(app, {}, 'javascript');
    await runCreateScreenFlow({
      ...common,
      cwd: app.root,
      name: 'Order',
      full: true,
      link: 'order/:id',
      params: 'id:number,draft?:boolean',
    } as never);
    await expectOnlyJavaScript();
  });

  it('create-slice writes JavaScript', async () => {
    await scaffoldReduxStore(app, 'javascript');
    await runCreateSliceFlow({ ...common, cwd: app.root, name: 'cart' });

    expect(await app.exists('src/store/slices/cartSlice.js')).toBe(true);
    await expectOnlyJavaScript();
  });

  it('create-component writes JavaScript, shared and in a screen', async () => {
    await scaffoldNavigation(app, {}, 'javascript');
    await runCreateScreenFlow({ ...common, cwd: app.root, name: 'Order', full: true } as never);
    await runCreateComponentFlow({ ...common, cwd: app.root, kind: 'component', name: 'OrderRow', shared: true });
    await runCreateComponentFlow({
      ...common,
      cwd: app.root,
      kind: 'component',
      name: 'OrderBadge',
      shared: false,
      screen: 'Order',
    });
    await expectOnlyJavaScript();
  });

  it('create-hook writes JavaScript, shared and in a screen', async () => {
    await scaffoldNavigation(app, {}, 'javascript');
    await runCreateScreenFlow({ ...common, cwd: app.root, name: 'Order', full: true } as never);
    await runCreateComponentFlow({ ...common, cwd: app.root, kind: 'hook', name: 'useOrderTotals', shared: true });
    await runCreateComponentFlow({
      ...common,
      cwd: app.root,
      kind: 'hook',
      name: 'useOrderDraft',
      shared: false,
      screen: 'Order',
    });

    expect(await app.exists('src/shared/hooks/useOrderTotals.js')).toBe(true);
    await expectOnlyJavaScript();
  });
});
