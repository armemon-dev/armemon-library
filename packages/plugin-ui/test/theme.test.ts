/**
 * Regression tests for the UI plugin's pure theme maths and generated output.
 */
import { describe, expect, it } from 'vitest';
import wizard from '../dist/wizard/index.mjs';
import type { PluginInstallPlan, WizardContext } from '@armemon-library/config-types';

const ctx: WizardContext = {
  appRoot: '/tmp/app',
  cwd: '/tmp',
  appName: 'MyApp',
  rnVersion: '0.76.0',
  packageManager: 'npm',
  platforms: ['ios'],
  language: 'typescript',
  flags: {},
  alreadyAnsweredByOtherPlugins: {},
};

const base = {
  themeMode: 'auto' as const,
  baseFontSize: 14,
  typeScaleRatio: 1.2,
  textScaleMode: 'both' as const,
  brandColor: '#5eead4',
  generateStarterComponents: true,
};

const fileAt = (plan: PluginInstallPlan, p: string) =>
  plan.filesToWrite.find((f) => f.path === p);

describe('generated theme config', () => {
  it('carries every answer into theme.config.ts', async () => {
    const plan = await wizard.plan({ ...base, brandColor: '#ff0000', baseFontSize: 16 }, ctx);
    const config = fileAt(plan, 'armemon/ui/theme.config.ts')!;
    expect(config.content).toContain("brandColor: '#ff0000'");
    expect(config.content).toContain('baseFontSize: 16');
  });

  it('writes the example screen only when asked', async () => {
    const withExample = await wizard.plan(base, ctx);
    expect(fileAt(withExample, 'src/armemon-examples/UiKitScreen.tsx')).toBeDefined();

    const without = await wizard.plan({ ...base, generateStarterComponents: false }, ctx);
    expect(fileAt(without, 'src/armemon-examples/UiKitScreen.tsx')).toBeUndefined();
  });

  it('adds no npm dependencies — it is pure React Native', async () => {
    const plan = await wizard.plan(base, ctx);
    expect(plan.npmDependencies).toEqual({});
  });
});

describe('font size resolution', () => {
  it('steps geometrically around the base', async () => {
    const { resolveFontSize } = await import('../dist/runtime/index.mjs');
    expect(resolveFontSize(14, 1.2, 'medium')).toBe(14);
    expect(resolveFontSize(14, 1.2, 'large')).toBe(17);
    expect(resolveFontSize(14, 1.2, 'small')).toBe(12);
  });

  it('never returns Infinity or zero from a degenerate config', async () => {
    const { resolveFontSize } = await import('../dist/runtime/index.mjs');
    // ratio 0 made the 'small' step (0 ** -1) Infinity.
    expect(Number.isFinite(resolveFontSize(14, 0, 'small'))).toBe(true);
    expect(resolveFontSize(0, 1.2, 'medium')).toBeGreaterThan(0);
  });
});
