/**
 * FILE: set.test.ts
 * PATH: packages/cli-armemon/test/set.test.ts
 *
 * WHAT: `armemon set` against a real app.
 * WHY:  The value coercion is the part that would be wrong silently: writing
 *       `themeMode: dark` instead of `themeMode: 'dark'` produces a reference to an
 *       undeclared name, which is a confusing thing to have to notice later. And the
 *       configs are mostly commented examples, so the edit has to land on the real
 *       property rather than the one being demonstrated above it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configLiteral, runSetFlow } from '../dist/index.js';
import { captureStdout, makeApp, resetCliState, writeConfig, type TestApp } from './support/screenApps';

const UI = 'armemon/ui/theme.config.ts';

let app: TestApp;

beforeEach(async () => {
  app = await makeApp();
  resetCliState();
});
afterEach(async () => {
  await app.remove();
  resetCliState();
});

/** A theme config in the shape the UI wizard writes, commented example included. */
async function scaffoldUi(): Promise<void> {
  await writeConfig(app);
  await app.write(
    UI,
    `import type { UiConfig } from '@armemon-library/ui';

export const uiConfig: UiConfig = {
  // themeMode
  //   'auto'   follow the device
  //   themeMode: 'dark',
  themeMode: 'auto',

  baseFontSize: 16,
  allowFontScaling: true,
};
`,
  );
}

const set = (options: Record<string, unknown> = {}) =>
  runSetFlow({ cwd: app.root, allAccept: true, verify: false, ...options } as never);

describe('configLiteral', () => {
  it('quotes a bare word, so the file gets a string and not a reference', () => {
    expect(configLiteral('dark')).toBe("'dark'");
  });

  it('leaves numbers and booleans as they are', () => {
    expect(configLiteral('18')).toBe('18');
    expect(configLiteral('1.25')).toBe('1.25');
    expect(configLiteral('true')).toBe('true');
  });

  it('leaves something already written as code or quoted alone', () => {
    expect(configLiteral("'dark'")).toBe("'dark'");
    expect(configLiteral('[1, 2]')).toBe('[1, 2]');
  });

  it('passes an expression through with --raw', () => {
    expect(configLiteral('__DEV__', true)).toBe('__DEV__');
  });

  it('escapes a quote inside the value', () => {
    expect(configLiteral("it's")).toBe("'it\\'s'");
  });
});

describe('set', () => {
  it('sets a string option, quoted', async () => {
    await scaffoldUi();
    await set({ target: 'ui.themeMode', value: 'dark' });

    expect(await app.read(UI)).toContain("themeMode: 'dark',");
  });

  /** The real property, not the one demonstrated in the comment above it. */
  it('leaves the commented-out example alone', async () => {
    await scaffoldUi();
    await set({ target: 'ui.themeMode', value: 'light' });

    const config = await app.read(UI);
    expect(config).toContain("//   themeMode: 'dark',");
    expect(config).toContain("themeMode: 'light',");
  });

  it('sets a number', async () => {
    await scaffoldUi();
    await set({ target: 'ui.baseFontSize', value: '18' });

    expect(await app.read(UI)).toContain('baseFontSize: 18,');
  });

  it('sets a boolean', async () => {
    await scaffoldUi();
    await set({ target: 'ui.allowFontScaling', value: 'false' });

    expect(await app.read(UI)).toContain('allowFontScaling: false,');
  });

  // The settable plugins come from their manifests, not a list in the CLI, so a
  // plugin installed in the app is settable exactly like a built-in one.
  it('sets an option of a plugin installed in the app, from its manifest', async () => {
    await writeConfig(app);
    await app.write(
      'package.json',
      JSON.stringify({ name: 'fixture', dependencies: { 'armemon-plugin-analytics': '1.0.0' } }, null, 2),
    );
    await app.write(
      'node_modules/armemon-plugin-analytics/package.json',
      JSON.stringify({
        name: 'armemon-plugin-analytics',
        version: '1.0.0',
        armemon: {
          manifestVersion: 1,
          pluginId: 'analytics',
          displayName: 'Analytics',
          description: 'Screen tracking.',
          runtimeExportName: 'AnalyticsPlugin',
          settings: { file: 'analytics/analytics.config.ts', exportName: 'analyticsConfig' },
        },
      }),
    );
    await app.write(
      'armemon/analytics/analytics.config.ts',
      'export const analyticsConfig = {\n  trackScreens: true,\n};\n',
    );

    await set({ target: 'analytics.trackScreens', value: 'false' });
    expect(await app.read('armemon/analytics/analytics.config.ts')).toContain('trackScreens: false');
  });

  it('refuses a plugin it does not know', async () => {
    await scaffoldUi();
    await expect(set({ target: 'nope.thing', value: '1' })).rejects.toMatchObject({
      message: expect.stringContaining('not an option armemon can set'),
    });
  });

  it('refuses an option with no plugin in front of it', async () => {
    await scaffoldUi();
    await expect(set({ target: 'themeMode', value: 'dark' })).rejects.toMatchObject({
      hint: expect.stringContaining('<plugin>.<option>'),
    });
  });

  it('says so when the app does not have that plugin', async () => {
    await writeConfig(app);
    await expect(set({ target: 'ui.themeMode', value: 'dark' })).rejects.toMatchObject({
      message: expect.stringContaining('no ui config'),
      // Pointing at the command that fixes it, now that plugins can be added later.
      hint: expect.stringContaining('armemon plugin add ui'),
    });
  });

  it('--dry-run writes nothing', async () => {
    await scaffoldUi();
    const before = await app.read(UI);

    await set({ target: 'ui.themeMode', value: 'dark', dryRun: true });

    expect(await app.read(UI)).toBe(before);
  });

  it('reports itself as JSON', async () => {
    await scaffoldUi();
    const json = await captureStdout(() => set({ target: 'ui.baseFontSize', value: '20', json: true }));

    expect(JSON.parse(json)).toMatchObject({
      ok: true,
      target: 'ui.baseFontSize',
      key: 'baseFontSize',
      value: '20',
      file: UI,
      changed: true,
    });
  });

  it('follows a dotted path into a nested option', async () => {
    await writeConfig(app);
    await app.write(
      'armemon/essentials/essentials.config.ts',
      "export const essentialsConfig = {\n  notifications: {\n    enabled: true,\n    position: 'top',\n  },\n};\n",
    );

    await set({ target: 'essentials.notifications.position', value: 'bottom' });

    expect(await app.read('armemon/essentials/essentials.config.ts')).toContain("position: 'bottom',");
  });
});
