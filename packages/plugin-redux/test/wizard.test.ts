/**
 * Regression tests for the Redux wizard. The persistence cases cover the defect
 * that made an app fail to bundle after answering "no" to persistence, and the
 * nanoid case covers a generated slice that threw on its first dispatch.
 */
import { describe, expect, it } from 'vitest';
import { activeCodeOf } from '@armemon-library/cli-kit';
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
  persistEnabled: true,
  persistKey: 'root',
  whitelist: ['counter'] as const,
  middlewares: [] as string[],
  devTools: 'auto' as const,
  sliceTemplates: ['counter'] as const,
  tokenName: 'token',
  useNanoid: false,
  storeVariableName: 'store',
  dependencyVersions: {},
};

const fileAt = (plan: PluginInstallPlan, p: string) =>
  plan.filesToWrite.find((f) => f.path === p);

/**
 * Generated config files document every option they accept as commented examples,
 * so a user never has to leave the editor. That means a bare substring search finds
 * things the docs merely MENTION — these assertions are about active code.
 */
const activeCode = (source: string): string => activeCodeOf(source, 'store.config.ts');

describe('persistence', () => {
  it('imports the persist adapter only when persistence is enabled', async () => {
    const plan = await wizard.plan({ ...base, persistEnabled: true } as never, ctx);
    const config = fileAt(plan, 'armemon/redux/store.config.ts')!;
    expect(config.content).toContain("from '@armemon-library/redux/persist'");
    expect(config.content).toContain('adapter: persistAdapter');
  });

  it('never mentions redux-persist when persistence is off', async () => {
    const plan = await wizard.plan({ ...base, persistEnabled: false, whitelist: [] } as never, ctx);
    const config = fileAt(plan, 'armemon/redux/store.config.ts')!;
    // This import is the only thing that pulls redux-persist and AsyncStorage into
    // the bundle. Its presence here is what used to break the build.
    const code = activeCode(config.content);
    expect(code).not.toContain('@armemon-library/redux/persist');
    expect(code).not.toContain('persistAdapter');
    expect(code).toContain('persist: { enabled: false }');
  });
});

describe('todos ids', () => {
  it('takes nanoid from Redux Toolkit, not the Hermes-incompatible standalone package', async () => {
    const plan = await wizard.plan(
      { ...base, sliceTemplates: ['todos'], useNanoid: true } as never,
      ctx,
    );
    expect(plan.npmDependencies['nanoid']).toBeUndefined();
    const slice = fileAt(plan, 'src/store/slices/todosSlice.ts')!;
    expect(slice.content).toContain("import { nanoid } from '@armemon-library/redux';");
    expect(slice.content).toContain('nanoid()');
  });

  it('falls back to Date.now() with no import when nanoid is declined', async () => {
    const plan = await wizard.plan(
      { ...base, sliceTemplates: ['todos'], useNanoid: false } as never,
      ctx,
    );
    const slice = fileAt(plan, 'src/store/slices/todosSlice.ts')!;
    expect(slice.content).not.toContain('nanoid');
    expect(slice.content).toContain('Date.now().toString()');
  });
});

describe('middleware', () => {
  it('wires redux-logger itself instead of asking the user to', async () => {
    const plan = await wizard.plan({ ...base, middlewares: ['redux-logger'] } as never, ctx);
    expect(plan.npmDependencies['redux-logger']).toBeDefined();
    const config = fileAt(plan, 'armemon/redux/store.config.ts')!;
    expect(activeCode(config.content)).toContain('middleware:');
    expect(plan.postInstallNotes?.join(' ') ?? '').not.toMatch(/wire it into/);
  });

  it('imports redux-logger statically, never through require()', async () => {
    // A conditional require() works under Metro and throws "require is not defined"
    // under Vite — during module evaluation, so the app's error boundary never sees
    // it and the web build renders a blank page.
    const plan = await wizard.plan({ ...base, middlewares: ['redux-logger'] } as never, ctx);
    const config = fileAt(plan, 'armemon/redux/store.config.ts')!;
    expect(config.content).toContain("import reduxLogger from 'redux-logger';");
    expect(activeCode(config.content)).not.toContain('require(');
  });

  it('emits no require() call in any generated file, for any answer combination', async () => {
    for (const middlewares of [[], ['redux-logger'], ['custom'], ['redux-logger', 'custom']]) {
      const plan = await wizard.plan({ ...base, middlewares } as never, ctx);
      for (const file of plan.filesToWrite) {
        expect(activeCode(file.content), `${file.path} must not use require()`).not.toContain(
          'require(',
        );
      }
    }
  });

  it('emits no middleware field when none was chosen', async () => {
    const plan = await wizard.plan(base as never, ctx);
    expect(activeCode(fileAt(plan, 'armemon/redux/store.config.ts')!.content)).not.toContain(
      'middleware:',
    );
  });
});

describe('slice templates', () => {
  it('renders the token field name into the auth slice', async () => {
    const plan = await wizard.plan(
      { ...base, sliceTemplates: ['auth'], tokenName: 'accessToken' } as never,
      ctx,
    );
    const slice = fileAt(plan, 'src/store/slices/authSlice.ts')!;
    expect(slice.content).toContain('accessToken: string | null;');
  });

  it('registers each chosen slice under its own key', async () => {
    const plan = await wizard.plan(
      { ...base, sliceTemplates: ['counter', 'user'], whitelist: ['counter'] } as never,
      ctx,
    );
    const config = fileAt(plan, 'armemon/redux/store.config.ts')!;
    expect(config.content).toContain('counter: counterSlice,');
    expect(config.content).toContain('user: userSlice,');
  });

  it('exports the fixed name runtime.generated imports', async () => {
    const plan = await wizard.plan(base as never, ctx);
    expect(fileAt(plan, 'armemon/redux/index.ts')!.content).toContain('export const ReduxPlugin');
    expect(plan.appEntryContributions?.providerImport.importName).toBe('ReduxPlugin');
  });
});

describe('devTools', () => {
  it.each([
    ['auto', 'devTools: __DEV__'],
    ['on', 'devTools: true'],
    ['off', 'devTools: false'],
  ])('emits the right expression for %s', async (mode, expected) => {
    const plan = await wizard.plan({ ...base, devTools: mode } as never, ctx);
    expect(fileAt(plan, 'armemon/redux/store.config.ts')!.content).toContain(expected);
  });
});
