/**
 * FILE: screenCli.test.ts
 * PATH: packages/cli-armemon/test/screenCli.test.ts
 *
 * WHAT: The screen commands through the real built binary.
 * WHY:  The flow suites call functions; scripts call the binary. Flag parsing
 *       (`--register` next to `--no-register`), JSON on stdout for success and failure,
 *       exit codes and running from a subfolder only exist at this layer — and
 *       `--json | jq` choking on a progress line is exactly the bug only this layer
 *       shows.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeApp, scaffoldNavigation, writeConfig, type TestApp } from './support/screenApps';

const BIN = fileURLToPath(new URL('../dist/bin/armemon.js', import.meta.url));

let app: TestApp;

beforeEach(async () => {
  app = await makeApp();
});
afterEach(async () => {
  await app.remove();
});

const cli = (args: string[], cwd = app.root) => {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, CI: 'true', FORCE_COLOR: '0' },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

describe('screen commands through the binary', () => {
  it('--json prints only JSON, for success and for failure, with matching exit codes', async () => {
    await scaffoldNavigation(app);

    const first = cli(['create-screen', 'Order', '--json', '--no-verify']);
    expect(first.status).toBe(0);
    expect(JSON.parse(first.stdout)).toMatchObject({ ok: true, routeName: 'Order' });

    const second = cli(['create-screen', 'Order', '--json', '--no-verify']);
    expect(second.status).toBe(1);
    expect(JSON.parse(second.stdout)).toEqual({
      schemaVersion: 1,
      ok: false,
      error: { message: 'src/screens/OrderScreen already exists.', hint: 'Pass --force to replace its index, or pick another name.' },
    });
  });

  it('parses --register as a real flag', async () => {
    await writeConfig(app);
    const result = cli(['create-screen', 'Order', '--register', '--flat', '--no-verify']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('This app has no RootNavigator to register a screen in.');
  });

  it('renames and removes from folders inside the app', async () => {
    await scaffoldNavigation(app);
    expect(cli(['create-screen', 'Order', '--json', '--no-verify']).status).toBe(0);

    const renamed = cli(['rename-screen', 'Order', 'Invoice', '--json', '--no-verify'], path.join(app.root, 'src', 'screens'));
    expect(renamed.status).toBe(0);
    expect(JSON.parse(renamed.stdout)).toMatchObject({ ok: true, to: { folder: 'src/screens/InvoiceScreen' } });

    const removed = cli(['remove-screen', 'Invoice', '--json', '--no-verify'], path.join(app.root, 'src'));
    expect(removed.status).toBe(0);
    expect(await app.exists('src/screens/InvoiceScreen')).toBe(false);
  });

  it('runs sync through the binary and reports it as JSON', async () => {
    await scaffoldNavigation(app);

    const result = cli(['sync', '--json', '--no-verify']);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, moved: null });
  });

  it('lists the commands and their flags in --help', () => {
    const help = cli(['--help']).stdout;
    expect(help).toContain('remove-screen');
    expect(help).toContain('rename-screen');
    expect(help).toContain('sync');

    const createHelp = cli(['create-screen', '--help']).stdout;
    for (const flag of ['--register', '--no-register', '--navigator <name>', '--params <list>', '--initial', '--modal', '--title <title>', '--dry-run']) {
      expect(createHelp).toContain(flag);
    }
  });

  it("prints commander's own errors as JSON under --json", async () => {
    await scaffoldNavigation(app);
    const result = cli(['create-screen', 'Order', '--json', '--bogus']);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, error: { message: expect.stringMatching(/^unknown option '--bogus'/) } });
  });

  // `--json` here is the title, not the flag. Matching it anywhere in argv switched
  // commander's own errors to JSON for someone reading a terminal.
  it('treats --json given as an option value as that value, not as the flag', async () => {
    await scaffoldNavigation(app);
    const result = cli(['create-screen', 'Order', '--title', '--json', '--bogus']);
    expect(result.status).toBe(1);
    expect(() => JSON.parse(result.stdout)).toThrow();
    expect(result.stderr).toContain("unknown option '--bogus'");
  });
});
