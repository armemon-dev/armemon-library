/**
 * One splash definition, three renderings.
 *
 * "Splash screen" is three different mechanisms sharing a name: the OS draws one
 * from generated assets before any JavaScript exists (iOS/Android), the browser
 * paints markup from index.html before the bundle parses (web), and core shows an
 * in-app screen while init tasks run (everywhere). These tests pin that all three
 * come from the same background colour and logo, and — critically — that the web
 * bundle never sees react-native-bootsplash, which has no web build and calls
 * TurboModuleRegistry.getEnforcing the moment it is imported.
 */
import { describe, expect, it } from 'vitest';
import wizard from '../dist/wizard/index.mjs';
import type { PluginInstallPlan, WizardContext } from '@armemon-library/config-types';

const ctx = (platforms: WizardContext['platforms']): WizardContext => ({
  appRoot: '/tmp/app',
  cwd: '/tmp',
  appName: 'MyApp',
  rnVersion: '0.76.0',
  packageManager: 'npm',
  platforms,
  language: 'typescript',
  flags: {},
  alreadyAnsweredByOtherPlugins: {},
});

const base = {
  logoPath: null as string | null,
  backgroundColor: '#101828',
  minSplashDurationMs: 1500,
  dependencyVersions: { 'react-native-bootsplash': '6.3.0' },
};

const fileAt = (plan: PluginInstallPlan, p: string) =>
  plan.filesToWrite.find((f) => f.path === p);

describe('one source of truth', () => {
  it('writes a splash.config every rendering reads', async () => {
    const plan = await wizard.plan(base, ctx(['ios', 'android', 'web']));
    const config = fileAt(plan, 'armemon/splash/splash.config.ts')!;
    expect(config.content).toContain("backgroundColor: '#101828'");
    expect(config.content).toContain('minSplashDurationMs: 1500');
  });

  it('generates an in-app screen coloured from that config', async () => {
    const plan = await wizard.plan(base, ctx(['ios', 'web']));
    const screen = fileAt(plan, 'src/armemon-examples/StartupSplash.tsx')!;
    expect(screen.content).toContain("from '../../armemon/splash/splash.config'");
    expect(screen.content).toContain('splashConfig.backgroundColor');
  });

  it('registers that screen with core, so it shows on every platform', async () => {
    const plan = await wizard.plan(base, ctx(['windows']));
    expect(plan.runtimeConfigContributions?.splashScreenComponent).toEqual({
      importName: 'default',
      // Relative to armemon/, where runtime.generated lives — the examples folder
      // stays in the author's zone, so this now crosses back into src/.
      from: '../src/armemon-examples/StartupSplash',
    });
    expect(plan.runtimeConfigContributions?.minSplashDurationMs).toBe(1500);
  });

  it('omits a zero minimum duration rather than emitting a no-op', async () => {
    const plan = await wizard.plan({ ...base, minSplashDurationMs: 0 }, ctx(['ios']));
    expect(plan.runtimeConfigContributions?.minSplashDurationMs).toBeUndefined();
  });
});

describe('web', () => {
  it('paints markup from index.html, before the bundle parses', async () => {
    const plan = await wizard.plan(base, ctx(['web']));
    expect(plan.htmlContributions?.head?.join('')).toContain('#armemon-splash');
    expect(plan.htmlContributions?.head?.join('')).toContain('#101828');
    expect(plan.htmlContributions?.bodyStart?.join('')).toContain('id="armemon-splash"');
  });

  it('copies the logo into web/public so the browser can actually serve it', async () => {
    // Vite serves only its public directory; a logo left at the app root is a 404.
    // The logo may also have come from outside the app entirely, so it is copied in
    // twice: once as a normal app asset, once where the web build can serve it.
    const plan = await wizard.plan(
      { ...base, logoPath: '/somewhere/else/logo.png' },
      ctx(['android', 'web']),
    );
    expect(plan.htmlContributions?.bodyStart?.join('')).toContain('src="/logo.png"');
    expect(plan.filesToCopy).toEqual([
      { from: '/somewhere/else/logo.png', to: 'assets/logo.png' },
      { from: '/somewhere/else/logo.png', to: 'web/public/logo.png' },
    ]);
  });

  it('points the native generator at the in-app copy, not the original path', async () => {
    // bootsplash runs with cwd at the app root, so an absolute path from the user's
    // own directory would only work by accident.
    const plan = await wizard.plan({ ...base, logoPath: '/elsewhere/logo.png' }, ctx(['android']));
    expect(plan.filesToCopy).toEqual([{ from: '/elsewhere/logo.png', to: 'assets/logo.png' }]);
    expect(plan.postInstallSteps?.[0]?.fallbackNote).toContain('assets/logo.png');
  });

  it('never pulls react-native-bootsplash into a web-only app', async () => {
    // It has no web build and calls TurboModuleRegistry.getEnforcing on import.
    const plan = await wizard.plan(base, ctx(['web']));
    expect(plan.npmDependencies['react-native-bootsplash']).toBeUndefined();
    const hide = fileAt(plan, 'armemon/splash/hide.ts')!;
    expect(hide.content).not.toMatch(/^\s*import .*bootsplash/m);
  });

  it('emits hide.web.ts so Vite resolves away from the native hide', async () => {
    const plan = await wizard.plan(base, ctx(['android', 'web']));
    const web = fileAt(plan, 'armemon/splash/hide.web.ts')!;
    expect(web.content).toContain('armemon-splash');
    // No IMPORT of it — the doc comment names it, which is the point of the file.
    expect(web.content).not.toMatch(/^\s*import .*bootsplash/m);

    // The native sibling is what Metro picks for the same import.
    const native = fileAt(plan, 'armemon/splash/hide.ts')!;
    expect(native.content).toContain('react-native-bootsplash');
  });

  it('writes no hide.web.ts when web is not targeted', async () => {
    const plan = await wizard.plan(base, ctx(['ios', 'android']));
    expect(fileAt(plan, 'armemon/splash/hide.web.ts')).toBeUndefined();
  });
});

describe('native', () => {
  it('defers asset generation to a post-install step', async () => {
    const plan = await wizard.plan({ ...base, logoPath: 'logo.png' }, ctx(['ios', 'android']));
    expect(plan.postInstallSteps).toHaveLength(1);
    expect(plan.postInstallSteps?.[0]?.fallbackNote).toContain('--platforms=ios,android');
  });

  it('derives --platforms from the real selection', async () => {
    const plan = await wizard.plan({ ...base, logoPath: 'logo.png' }, ctx(['android', 'web']));
    expect(plan.postInstallSteps?.[0]?.fallbackNote).toContain('--platforms=android');
    expect(plan.postInstallSteps?.[0]?.fallbackNote).not.toContain('ios');
  });

  it('installs bootsplash only when a native platform is targeted', async () => {
    const withNative = await wizard.plan(base, ctx(['android']));
    expect(withNative.npmDependencies['react-native-bootsplash']).toBe('6.3.0');

    const webOnly = await wizard.plan(base, ctx(['web']));
    expect(webOnly.npmDependencies['react-native-bootsplash']).toBeUndefined();
  });

  it('says what it deliberately did not automate', async () => {
    const plan = await wizard.plan({ ...base, logoPath: 'logo.png' }, ctx(['ios']));
    expect(plan.postInstallNotes.join(' ')).toMatch(/RNBootSplash\.init/);
  });

  it('runs no generator step and says so when no logo was given', async () => {
    const plan = await wizard.plan(base, ctx(['ios']));
    expect(plan.postInstallSteps).toBeUndefined();
    expect(plan.postInstallNotes.join(' ')).toMatch(/once you have one/);
  });
});

describe('glue', () => {
  it('imports hide extensionlessly, which is what makes one plugin serve both', async () => {
    const plan = await wizard.plan(base, ctx(['ios', 'web']));
    const glue = fileAt(plan, 'armemon/splash/index.ts')!;
    expect(glue.content).toMatch(/^import \{ hideSplash \} from '\.\/hide';$/m);
    expect(glue.content).not.toMatch(/from '\.\/hide\.web'/);
    expect(glue.content).toContain('configureSplashPlugin');
  });

  it('is offered on every platform now, not just mobile', async () => {
    const pkg = await import('../package.json', { with: { type: 'json' } });
    expect(pkg.default.armemon.platforms).toBeUndefined();
  });
});

describe('what armemon.config records', () => {
  // The logo answer is an absolute path on the machine that ran the CLI. Writing it
  // verbatim put a home directory into a file the app commits — useless to a
  // teammate, and it leaks the operator's directory layout.
  it('records the in-app copy of the logo, not the operator\'s path', async () => {
    const plan = await wizard.plan(
      { ...base, logoPath: '/home/someone/pictures/brand.png' },
      ctx(['ios', 'android', 'web']),
    );

    expect(plan.recordedAnswers).toBeDefined();
    expect(plan.recordedAnswers!.logoPath).toBe('assets/brand.png');
    expect(JSON.stringify(plan.recordedAnswers)).not.toMatch(/\/(home|Users)\/[a-z]/i);
    // Everything else the user answered is preserved exactly.
    expect(plan.recordedAnswers!.backgroundColor).toBe(base.backgroundColor);
  });

  it('records nothing special when there is no logo', async () => {
    const plan = await wizard.plan({ ...base, logoPath: null }, ctx(['ios']));
    expect(plan.recordedAnswers).toBeUndefined();
  });

  it('never writes an operator path into the generated splash config either', async () => {
    const plan = await wizard.plan(
      { ...base, logoPath: '/Users/someone/Desktop/brand.png' },
      ctx(['ios', 'android', 'web']),
    );
    for (const file of plan.filesToWrite) {
      expect(file.content, file.path).not.toMatch(/\/(home|Users)\/[a-z]/i);
    }
  });
});
