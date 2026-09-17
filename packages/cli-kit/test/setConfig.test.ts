/**
 * FILE: setConfig.test.ts
 * PATH: packages/cli-kit/test/setConfig.test.ts
 *
 * WHAT: Setting one property in a generated plugin config.
 * WHY:  These configs are the files armemon most expects people to open by hand, and
 *       they are mostly comments — every option documented inline, with examples that
 *       look exactly like real settings. So this has to be parser-backed, and it has
 *       to know the difference between a value and code: `middleware:
 *       (defaultMiddleware) => …` is behaviour someone wrote, and replacing it with a
 *       scalar would remove it with nothing failing afterwards.
 */
import { describe, expect, it } from 'vitest';
import { setConfigProperty } from '../dist/index.js';

const UI = `import type { UiConfig } from '@armemon-library/ui';

export const uiConfig: UiConfig = {
  // themeMode
  //   'auto'   follow the device
  //   themeMode: 'dark',
  themeMode: 'auto',

  baseFontSize: 16,
};
`;

const ESSENTIALS = `export const essentialsConfig = {
  notifications: {
    enabled: true,
    position: 'top',
  },
};
`;

const REDUX = `export const reduxConfig = {
  slices: {},
  devTools: __DEV__,
  middleware: (defaultMiddleware) => [...defaultMiddleware],
};
`;

const set = (content: string, key: string, value: string, extra = {}) =>
  setConfigProperty(content, { exportName: content.includes('uiConfig') ? 'uiConfig' : content.includes('essentialsConfig') ? 'essentialsConfig' : 'reduxConfig', key, value, ...extra });

describe('setConfigProperty', () => {
  it('replaces an existing value', () => {
    const { content, changed } = set(UI, 'themeMode', "'dark'");

    expect(changed).toBe(true);
    expect(content).toContain("themeMode: 'dark',");
  });

  /** The commented example reads `themeMode: 'dark',` — it must stay a comment. */
  it('does not touch the commented-out example above it', () => {
    expect(set(UI, 'themeMode', "'light'").content).toContain("//   themeMode: 'dark',");
  });

  it('replaces a number', () => {
    expect(set(UI, 'baseFontSize', '18').content).toContain('baseFontSize: 18,');
  });

  it('adds a property that is not there yet', () => {
    const { content, changed } = set(UI, 'typeScaleRatio', '1.25');
    expect(changed).toBe(true);
    expect(content).toContain('typeScaleRatio: 1.25');
  });

  it('reports a value that is already what was asked for', () => {
    const result = set(UI, 'themeMode', "'auto'");
    expect(result.changed).toBe(false);
    expect(result.already).toBe(true);
  });

  it('follows a dotted path into a nested object', () => {
    const { content, changed } = set(ESSENTIALS, 'notifications.position', "'bottom'");

    expect(changed).toBe(true);
    expect(content).toContain("position: 'bottom',");
    expect(content).toContain('enabled: true,');
  });

  it('refuses to invent a missing intermediate object', () => {
    const result = set(ESSENTIALS, 'loading.overlay', 'true');

    expect(result.changed).toBe(false);
    expect(result.reason).toMatch(/no `loading` object/);
  });

  /**
   * The case that matters most: middleware is a function someone wrote. Replacing it
   * with a scalar compiles and quietly drops their configuration.
   */
  it('refuses to overwrite code with a value', () => {
    const result = set(REDUX, 'middleware', 'false');

    expect(result.changed).toBe(false);
    expect(result.conflict).toBe(true);
    expect(result.reason).toMatch(/set to code/);
    expect(result.manual).toMatch(/--force/);
  });

  it('overwrites code when forced', () => {
    expect(set(REDUX, 'middleware', 'undefined', { force: true }).changed).toBe(true);
  });

  it('treats a bare identifier like __DEV__ as a value it may replace', () => {
    expect(set(REDUX, 'devTools', 'false').content).toContain('devTools: false,');
  });

  it('refuses a config object it cannot find', () => {
    const result = setConfigProperty(UI, { exportName: 'nopeConfig', key: 'a', value: '1' });
    expect(result.changed).toBe(false);
    expect(result.reason).toMatch(/couldn't find/);
  });

  it('refuses a file that does not parse', () => {
    const result = set('export const uiConfig = {{{\n', 'themeMode', "'dark'");
    expect(result.changed).toBe(false);
    expect(result.reason).toMatch(/doesn't parse/);
  });
});
