/**
 * Regression tests for the navigation wizard's generated output. The first block
 * covers the defect that produced four TypeScript errors in every --all-accept
 * scaffold: screens importing './types' from a directory where types.ts is one
 * level up.
 */
import { describe, expect, it } from 'vitest';

import wizard from '../dist/wizard/index.mjs';
import type { PluginInstallPlan, WizardContext } from '@armemon-library/config-types';

const ctx = (overrides: Partial<WizardContext> = {}): WizardContext => ({
  appRoot: '/tmp/app',
  cwd: '/tmp',
  appName: 'MyApp',
  rnVersion: '0.76.0',
  packageManager: 'npm',
  platforms: ['ios', 'android'],
  language: 'typescript',
  flags: {},
  alreadyAnsweredByOtherPlugins: {},
  ...overrides,
});

const base = {
  navigatorType: 'stack' as const,
  initialRouteName: 'Home',
  screenCount: 2,
  enableDeepLinking: false,
  typedRoutes: true,
  dependencyVersions: {},
  sampleAuthFlow: false,
};

const fileAt = (plan: PluginInstallPlan, p: string) =>
  plan.filesToWrite.find((f) => f.path === p);

describe('sample auth flow', () => {
  it('imports RootStackParamList from where types.ts is actually written', async () => {
    const plan = await wizard.plan({ ...base, sampleAuthFlow: true }, ctx());

    const screens = plan.filesToWrite.filter((f) => f.path.includes('/screens/'));
    expect(screens.length).toBeGreaterThan(0);
    for (const screen of screens) {
      expect(screen.content, `${screen.path} must not import './types'`).not.toContain(
        "from './types'",
      );
      expect(screen.content).toContain("from '../../../armemon/navigation/types'");
    }
    expect(fileAt(plan, 'armemon/navigation/types.ts')).toBeDefined();
  });

  it('reads the auth slice token field the Redux wizard actually chose', async () => {
    const plan = await wizard.plan(
      { ...base, sampleAuthFlow: true },
      ctx({
        alreadyAnsweredByOtherPlugins: {
          redux: { sliceTemplates: ['auth'], tokenName: 'accessToken' },
        },
      }),
    );
    const splash = fileAt(plan, 'src/screens/SplashScreen/index.tsx')!;
    expect(splash.content).toContain('state.auth?.accessToken');
    expect(splash.content).not.toContain('state.auth?.token)');
  });

  it('falls back to local state, and says so, when Redux auth is absent', async () => {
    const plan = await wizard.plan({ ...base, sampleAuthFlow: true }, ctx());
    const login = fileAt(plan, 'src/screens/LoginScreen/index.tsx')!;
    expect(login.content).not.toContain('@armemon-library/redux');
    expect(plan.postInstallNotes?.join(' ')).toMatch(/local state/);
  });

  it('imports the auth slice by a path that resolves from screens/', async () => {
    const plan = await wizard.plan(
      { ...base, sampleAuthFlow: true },
      ctx({ alreadyAnsweredByOtherPlugins: { redux: { sliceTemplates: ['auth'] } } }),
    );
    const login = fileAt(plan, 'src/screens/LoginScreen/index.tsx')!;
    // src/screens/LoginScreen/ -> src/, then store/slices
    expect(login.content).toContain("from '../../store/slices/authSlice'");
  });
});

describe('placeholder screens', () => {
  it('de-duplicates when the initial route collides with a generated name', async () => {
    const plan = await wizard.plan({ ...base, initialRouteName: 'Screen2', screenCount: 2 }, ctx());
    const screenFiles = plan.filesToWrite.filter((f) => f.path.includes('/screens/'));
    const paths = screenFiles.map((f) => f.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toHaveLength(2);
  });

  it('writes exactly screenCount screens', async () => {
    const plan = await wizard.plan({ ...base, screenCount: 4 }, ctx());
    expect(plan.filesToWrite.filter((f) => f.path.includes('/screens/'))).toHaveLength(4);
  });
});

describe('drawer navigator', () => {
  it('wires gesture-handler and reanimated instead of leaving a manual note', async () => {
    const plan = await wizard.plan({ ...base, navigatorType: 'drawer' }, ctx());
    expect(plan.entryPrelude).toContain("import 'react-native-gesture-handler';");
    expect(plan.babelPlugins?.join(' ')).toContain('react-native-reanimated/plugin');
    // The old behaviour: telling the user to edit two files by hand.
    expect(plan.postInstallNotes?.join(' ') ?? '').not.toMatch(/first line of index\.js/);
  });

  it('adds nothing extra for a plain stack', async () => {
    const plan = await wizard.plan(base, ctx());
    expect(plan.entryPrelude).toBeUndefined();
    expect(plan.babelPlugins).toBeUndefined();
  });
});

/**
 * The generated types file opens with a doc block that shows, among other things, a
 * nested-navigator param list. Every assertion about what the file DECLARES has to
 * skip that block first — searching the whole file finds the example and passes (or
 * fails) on documentation instead of on generated code. activeCodeOf isn't usable
 * here: this file is types only, so stripping to runtime code leaves nothing at all.
 */
const declarations = (source: string): string => source.slice(source.indexOf('*/') + 2);

describe('typed routes', () => {
  it('nests the tab param list under the stack for stack-with-tabs', async () => {
    const plan = await wizard.plan({ ...base, navigatorType: 'stack-with-tabs' }, ctx());
    const types = declarations(fileAt(plan, 'armemon/navigation/types.ts')!.content);
    expect(types).toContain('Tabs: NavigatorScreenParams<TabParamList>');
    expect(types).toContain('export type TabParamList');
  });

  it('uses a flat param list for a plain stack', async () => {
    const plan = await wizard.plan(base, ctx());
    const types = declarations(fileAt(plan, 'armemon/navigation/types.ts')!.content);
    expect(types).toContain('Home: undefined;');
    expect(types).not.toContain('NavigatorScreenParams');
  });

  it('writes no types file when typed routes are off', async () => {
    const plan = await wizard.plan({ ...base, typedRoutes: false }, ctx());
    expect(fileAt(plan, 'armemon/navigation/types.ts')).toBeUndefined();
  });
});

describe('deep linking', () => {
  it('says the native scheme registration is still needed', async () => {
    const plan = await wizard.plan({ ...base, enableDeepLinking: true }, ctx());
    expect(fileAt(plan, 'armemon/navigation/navigation.config.ts')).toBeDefined();
    expect(plan.postInstallNotes?.join(' ')).toMatch(/Info\.plist/);
    expect(plan.postInstallNotes?.join(' ')).toMatch(/AndroidManifest/);
  });

  it('writes each path as the route was typed — the same rule as create-screen', async () => {
    const plan = await wizard.plan({ ...base, enableDeepLinking: true }, ctx());
    const config = fileAt(plan, 'armemon/navigation/navigation.config.ts')!.content;

    expect(config).toContain("      Home: 'Home',");
    expect(config).toContain("      Screen2: 'Screen2',");
    expect(config).toContain('myapp://Screen2');
  });

  it('nests stack-with-tabs routes under Tabs, where React Navigation looks for them', async () => {
    const plan = await wizard.plan({ ...base, enableDeepLinking: true, navigatorType: 'stack-with-tabs' as const }, ctx());
    const config = fileAt(plan, 'armemon/navigation/navigation.config.ts')!.content;

    expect(config).toContain("      Tabs: {\n        screens: {\n          Home: 'Home',\n          Screen2: 'Screen2',\n        },\n      },");
    expect(config).not.toMatch(/^ {6}Home: 'Home',$/m);
  });

  it('points its example link at a route the app actually has', async () => {
    const plan = await wizard.plan({ ...base, enableDeepLinking: true, screenCount: 1 }, ctx());
    const config = fileAt(plan, 'armemon/navigation/navigation.config.ts')!.content;

    expect(config).toContain('myapp://Home');
    expect(config).not.toMatch(/screen2/i);
  });
});

describe('manifest', () => {
  it('declares the redux ordering dependency it actually relies on', async () => {
    const pkg = await import('../package.json', { with: { type: 'json' } });
    expect(pkg.default.armemon.dependsOn).toContain('redux');
  });
});
