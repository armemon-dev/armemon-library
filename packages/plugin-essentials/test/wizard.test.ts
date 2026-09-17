/**
 * Regression tests for the Essentials wizard. The netinfo cases cover the defect
 * that made an app fail to bundle after deselecting the network sub-feature.
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
  platforms: ['ios', 'android'],
  language: 'typescript',
  flags: {},
  alreadyAnsweredByOtherPlugins: {},
};

const base = {
  subFeatures: ['notifications', 'network', 'loading'] as string[],
  toastPosition: 'top' as const,
  toastDelay: 3000,
  toastSwipeable: true,
  networkMode: 'internet' as const,
  networkPolling: false,
  pollInterval: 10000,
  showOfflineBanner: true,
  loadingStyle: 'progressbar' as const,
  historyLimit: 100,
  dependencyVersions: {},
};

const fileAt = (plan: PluginInstallPlan, p: string) =>
  plan.filesToWrite.find((f) => f.path === p);

describe('network sub-feature', () => {
  it('imports the netinfo adapter when network monitoring is on', async () => {
    const plan = await wizard.plan(base as never, ctx);
    const glue = fileAt(plan, 'armemon/essentials/index.ts')!;
    expect(glue.content).toContain("from '@armemon-library/essentials/netinfo'");
    expect(glue.content).toContain('netInfoAdapter,');
  });

  it('never mentions netinfo when network monitoring is off', async () => {
    // That import is the only thing that pulls netinfo into the bundle; emitting it
    // while the wizard declined to install the package broke Metro resolution.
    const plan = await wizard.plan(
      { ...base, subFeatures: ['notifications', 'loading'] } as never,
      ctx,
    );
    const glue = fileAt(plan, 'armemon/essentials/index.ts')!;
    expect(glue.content).not.toContain('netinfo');
    expect(glue.content).not.toContain('netInfoAdapter');
    expect(fileAt(plan, 'armemon/essentials/essentials.config.ts')!.content).toContain(
      'enabled: false',
    );
  });
});

describe('config generation', () => {
  it('uses the poll interval the user chose rather than a hardcoded one', async () => {
    const plan = await wizard.plan({ ...base, networkPolling: true, pollInterval: 30000 } as never, ctx);
    expect(fileAt(plan, 'armemon/essentials/essentials.config.ts')!.content).toContain(
      'pollInterval: 30000',
    );
  });

  it('carries the notification history cap through', async () => {
    const plan = await wizard.plan({ ...base, historyLimit: 25 } as never, ctx);
    expect(fileAt(plan, 'armemon/essentials/essentials.config.ts')!.content).toContain(
      'historyLimit: 25',
    );
  });

  it('marks each deselected sub-feature disabled', async () => {
    const plan = await wizard.plan({ ...base, subFeatures: [] } as never, ctx);
    const config = fileAt(plan, 'armemon/essentials/essentials.config.ts')!.content;
    expect(config.match(/enabled: false/g)).toHaveLength(3);
  });

  it('exports the fixed name runtime.generated imports', async () => {
    const plan = await wizard.plan(base as never, ctx);
    expect(plan.appEntryContributions?.providerImport.importName).toBe('EssentialsPlugin');
  });
});
