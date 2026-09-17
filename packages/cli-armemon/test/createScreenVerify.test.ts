/**
 * FILE: createScreenVerify.test.ts
 * PATH: packages/cli-armemon/test/createScreenVerify.test.ts
 *
 * WHAT: create-screen when armemon's own checks fail afterwards.
 * WHY:  A screen that broke the type-check used to exit 0 — green in CI. The checks
 *       themselves run tsc and a web build, far too slow and machine-dependent for a
 *       unit test, so they are replaced with failing reports and what's tested is the
 *       outcome: exit code 1, the failure in the summary, the screen left in place, and
 *       an honest answer to "was it this command?" — the type-check covers the whole
 *       app, so errors in files the command never touched may have been there already.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyGeneratedApp } from '@armemon-library/cli-kit';
import { runCreateScreenFlow } from '../dist/index.js';
import { captureStdout, makeApp, resetCliState, scaffoldNavigation, type TestApp } from './support/screenApps';

vi.mock('@armemon-library/cli-kit', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, verifyGeneratedApp: vi.fn() };
});

let app: TestApp;

beforeEach(async () => {
  app = await makeApp();
  await scaffoldNavigation(app);
});
afterEach(async () => {
  resetCliState();
  await app.remove();
});

const failing = (files: string[]) => ({
  ok: false,
  checks: [{ name: 'type-check', ok: false, detail: "TS2304: Cannot find name 'Nope'.", files }],
});

const run = async () =>
  JSON.parse(await captureStdout(() => runCreateScreenFlow({ name: 'Order', cwd: app.root, json: true, full: true } as never)));

describe('create-screen verification', () => {
  it('exits 1 and reports the failed check, keeping the screen', async () => {
    vi.mocked(verifyGeneratedApp).mockResolvedValueOnce(failing(['src/screens/OrderScreen/index.tsx']));
    const summary = await run();

    expect(summary).toMatchObject({ ok: false, verification: { ok: false, inChangedFiles: true, checks: [{ name: 'type-check', ok: false }] } });
    expect(process.exitCode).toBe(1);
    expect(await app.exists('src/screens/OrderScreen/index.tsx')).toBe(true);
  });

  it('says when the errors are in files the command never touched', async () => {
    vi.mocked(verifyGeneratedApp).mockResolvedValueOnce(failing(['src/legacy/OldScreen.tsx']));
    const summary = await run();

    expect(summary.verification).toMatchObject({ ok: false, inChangedFiles: false });
  });
});
