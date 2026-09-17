/**
 * Cross-plugin guards on generated source.
 *
 * Every file armemon writes has to work under BOTH Metro and Vite, and the two
 * disagree. A conditional `require('redux-logger')` ran fine on native and threw
 * "ReferenceError: require is not defined" the moment the web target loaded the
 * same file — during module evaluation, before React mounts, so the app's error
 * boundary never saw it and the page was simply blank.
 *
 * Nothing else in the suite could catch that: `tsc` type-checks it happily, and
 * `vite build` succeeds because Rollup never evaluates the module. Only loading the
 * page does — and `--all-accept` can't even select redux-logger, so no CI scaffold
 * would have reached it. A static check across every wizard and many answer
 * combinations is the cheap, durable way to hold the line.
 */
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { activeCodeOf, convertFilesToJavaScript, javaScriptSyntaxErrors } from '@armemon-library/cli-kit';
import { DEFAULT_LAYOUT } from '@armemon-library/config-types';
import type { PluginInstallPlan, WizardContext } from '@armemon-library/config-types';

const ctx = (over: Partial<WizardContext> = {}): WizardContext => ({
  appRoot: '/tmp/app',
  cwd: '/tmp',
  appName: 'GenApp',
  rnVersion: '0.76.0',
  packageManager: 'npm',
  platforms: ['ios', 'android', 'web'],
  language: 'typescript',
  flags: {},
  alreadyAnsweredByOtherPlugins: {},
  ...over,
});

const load = async (pkg: string) =>
  (await import(`../../${pkg}/dist/wizard/index.mjs`)).default as {
    plan(answers: unknown, ctx: WizardContext): Promise<PluginInstallPlan>;
  };

const reduxBase = {
  persistEnabled: true, persistKey: 'root', whitelist: ['counter'], middlewares: [] as string[],
  devTools: 'auto', sliceTemplates: ['counter'], tokenName: 'token', useNanoid: false,
  storeVariableName: 'store', dependencyVersions: {},
};
const navBase = {
  navigatorType: 'stack', initialRouteName: 'Home', screenCount: 2, enableDeepLinking: false,
  typedRoutes: true, dependencyVersions: {}, sampleAuthFlow: false,
};
const essBase = {
  subFeatures: ['notifications', 'network', 'loading'], toastPosition: 'top', toastDelay: 3000,
  toastSwipeable: true, networkMode: 'internet', networkPolling: true, pollInterval: 10000,
  showOfflineBanner: true, loadingStyle: 'progressbar', historyLimit: 100, dependencyVersions: {},
};
const uiBase = {
  themeMode: 'auto', baseFontSize: 14, typeScaleRatio: 1.2, textScaleMode: 'both',
  brandColor: '#5eead4', generateStarterComponents: true,
};
const splashBase = {
  logoPath: null, backgroundColor: '#FFFFFF', minSplashDurationMs: 3000, dependencyVersions: {},
};
const advBase = {
  envStrategy: 'react-native-dotenv', pathAliases: true, bundleId: 'com.genapp', lintStyle: 'opinionated',
};

/** Every wizard crossed with the answers that change what it emits. */
const combinations: Array<[string, string, unknown]> = [
  ['plugin-redux', 'default', reduxBase],
  ['plugin-redux', 'logger', { ...reduxBase, middlewares: ['redux-logger'] }],
  ['plugin-redux', 'logger+custom', { ...reduxBase, middlewares: ['redux-logger', 'custom'] }],
  ['plugin-redux', 'no persist', { ...reduxBase, persistEnabled: false, whitelist: [] }],
  ['plugin-redux', 'all slices', { ...reduxBase, sliceTemplates: ['counter', 'auth', 'user', 'todos'], useNanoid: true }],
  ['plugin-navigation', 'stack', navBase],
  ['plugin-navigation', 'tabs', { ...navBase, navigatorType: 'tabs' }],
  ['plugin-navigation', 'drawer', { ...navBase, navigatorType: 'drawer' }],
  ['plugin-navigation', 'stack-with-tabs', { ...navBase, navigatorType: 'stack-with-tabs' }],
  ['plugin-navigation', 'deep linking', { ...navBase, enableDeepLinking: true }],
  ['plugin-navigation', 'sample flow', { ...navBase, sampleAuthFlow: true }],
  ['plugin-essentials', 'all', essBase],
  ['plugin-essentials', 'no network', { ...essBase, subFeatures: ['notifications'] }],
  ['plugin-ui', 'default', uiBase],
  ['plugin-ui', 'no starter', { ...uiBase, generateStarterComponents: false }],
  ['builtin-splash', 'default', splashBase],
  // With a logo, because the answer arrives as an ABSOLUTE path from wherever the
  // user ran the CLI — the one input that can put a build machine's directory
  // layout into a file the app then commits.
  ['builtin-splash', 'with logo', { ...splashBase, logoPath: '/home/someone/pictures/logo.png' }],
  ['builtin-advanced-init', 'opinionated', advBase],
  ['builtin-advanced-init', 'minimal', { ...advBase, envStrategy: 'none', pathAliases: false, lintStyle: 'default' }],
];

/**
 * CJS-only constructs. Metro accepts all of these; a browser bundle has none of
 * them defined, and the failure lands at module-evaluation time where no error
 * boundary can report it.
 */
const CJS_PATTERNS: Array<[RegExp, string]> = [
  [/\brequire\s*\(/, 'require() — not defined in a browser bundle'],
  [/\bmodule\.exports\b/, 'module.exports — not defined in an ES module'],
  [/\bexports\.\w/, 'exports.* — not defined in an ES module'],
  [/\b__dirname\b/, '__dirname — not defined in a browser bundle'],
  [/\bprocess\.cwd\s*\(/, 'process.cwd() — not available in a browser bundle'],
];

/** Files TypeScript can parse, and so strip comments from, before the scan below. */
const SOURCE_FILES = /\.(ts|tsx|js|jsx|mts|cts)$/;

/** Config files armemon writes for Node tooling, which are legitimately CJS. */
const NODE_CONFIG_FILES = /(^|\/)(babel\.config\.js|metro\.config\.js|jest\.[\w.]+\.js|\.prettierrc\.js|jest\.setup\.js)$/;

describe('generated app source is bundler-agnostic', () => {
  it.each(combinations)('%s (%s) emits no CJS-only construct', async (pkg, _label, answers) => {
    const wizard = await load(pkg);
    const plan = await wizard.plan(answers, ctx());

    for (const file of plan.filesToWrite) {
      if (NODE_CONFIG_FILES.test(file.path)) continue;
      // Generated files carry their own documentation, and that documentation is
      // allowed to talk about require() — including to explain why the code below
      // it doesn't use one. Scan what the file DOES.
      const code = SOURCE_FILES.test(file.path) ? activeCodeOf(file.content, file.path) : file.content;
      for (const [pattern, why] of CJS_PATTERNS) {
        expect(pattern.test(code), `${file.path} uses ${why}`).toBe(false);
      }
    }
  });

  it.each(combinations)('%s (%s) emits no absolute host path', async (pkg, _label, answers) => {
    // A leaked build-machine path makes the app non-portable in a way that only
    // shows up on someone else's machine.
    const wizard = await load(pkg);
    const plan = await wizard.plan(answers, ctx());
    for (const file of plan.filesToWrite) {
      expect(file.content, `${file.path} leaks a host path`).not.toMatch(/\/(home|Users)\/[a-z]/i);
    }
  });

  it.each(combinations)('%s (%s) writes only inside the app', async (pkg, _label, answers) => {
    const wizard = await load(pkg);
    const plan = await wizard.plan(answers, ctx());
    for (const file of plan.filesToWrite) {
      expect(file.path.startsWith('/'), `${file.path} is absolute`).toBe(false);
      expect(file.path.includes('..'), `${file.path} escapes the app root`).toBe(false);
    }
  });
});

describe('every wizard converts cleanly to JavaScript', () => {
  // React Native ships no JS template, so armemon strips types centrally at the
  // write boundary. That only holds if every generator's output actually survives
  // the strip — a leftover annotation lands as a syntax error in the user's build,
  // not here.
  it.each(combinations)('%s (%s) produces valid JavaScript', async (pkg, _label, answers) => {
    const wizard = await load(pkg);
    const plan = await wizard.plan(answers, ctx({ language: 'javascript' }));
    const { files } = await convertFilesToJavaScript(plan.filesToWrite);

    for (const file of files) {
      if (!/\.jsx?$/.test(file.path)) continue;
      const errors = javaScriptSyntaxErrors(file.content, file.path);
      expect(errors, `${file.path}: ${errors.join('; ')}`).toEqual([]);
    }
  });

  it.each(combinations)('%s (%s) points at no .ts sibling', async (pkg, _label, answers) => {
    // Documentation that says "see ./hide.ts" is wrong in an app whose files are
    // all .js, and it is wrong in the most annoying possible way: the reader opens
    // the file explorer looking for something that was never written.
    const wizard = await load(pkg);
    const plan = await wizard.plan(answers, ctx({ language: 'javascript' }));
    const { files } = await convertFilesToJavaScript(plan.filesToWrite);

    for (const file of files) {
      const named = file.content.match(/[\w./-]+\.tsx?\b/g) ?? [];
      expect(named, `${file.path} names ${named.join(', ')}`).toEqual([]);
    }
  });

  it.each(combinations)('%s (%s) points at no dropped module', async (pkg, _label, answers) => {
    // A type-only module is dropped whole in a JavaScript app. Any comment still
    // telling the reader to go edit it now names nothing at all — and unlike a
    // renamed file, there is no correct name to rewrite it to, so the text itself
    // has to be language-aware.
    const wizard = await load(pkg);
    const plan = await wizard.plan(answers, ctx({ language: 'javascript' }));
    const { files, dropped } = await convertFilesToJavaScript(plan.filesToWrite);

    for (const path of dropped) {
      const moduleName = path.split('/').pop()!.replace(/\.tsx?$/, '');
      // Any depth, and the src/-rooted spelling too. The old form only understood
      // one or two dot segments, so when screens moved further from the module they
      // reference, this stopped matching and quietly checked nothing.
      const reference = new RegExp(
        `(?:^|[\\s'"(\\[])(?:(?:\\.{1,2}/)+|src/)(?:[\\w.-]+/)*${moduleName}\\b`,
      );
      for (const file of files) {
        expect(file.content, `${file.path} still points at the dropped ${path}`).not.toMatch(
          reference,
        );
      }
    }
  });

  it.each(combinations)('%s (%s) leaves no .ts/.tsx behind', async (pkg, _label, answers) => {
    const wizard = await load(pkg);
    const plan = await wizard.plan(answers, ctx({ language: 'javascript' }));
    const { files } = await convertFilesToJavaScript(plan.filesToWrite);
    for (const file of files) {
      expect(file.path.endsWith('.ts') || file.path.endsWith('.tsx'), file.path).toBe(false);
    }
  });
});

/**
 * The generated configs are the documentation.
 *
 * Every option armemon can write into an app is meant to be present in the app's
 * own files as a commented, explained example — the app author reads and edits
 * their own config instead of looking anything up. That property is invisible to
 * every other check here: a generator that quietly drops its comment blocks still
 * builds, still type-checks, still converts to JavaScript. Only this notices.
 */
describe('generated configs document themselves', () => {
  const commentLines = (source: string): number =>
    source.split('\n').filter((line) => /^\s*(\/\/|\/\*|\*)/.test(line)).length;

  it.each(combinations)('%s (%s) explains the options it writes', async (pkg, _label, answers) => {
    const wizard = await load(pkg);
    const plan = await wizard.plan(answers, ctx());

    const documented = plan.filesToWrite.filter((f) => /\.config\.tsx?$/.test(f.path));
    for (const file of documented) {
      expect(file.content, `${file.path} has no doc block`).toContain('/**');
      expect(commentLines(file.content), `${file.path} is barely documented`).toBeGreaterThan(15);
      // A config that merely names the values the user already picked teaches
      // nothing — the alternatives, and what each one costs, are the point. In a
      // file written to be read instead of a docs site, prose outweighs code.
      const code = activeCodeOf(file.content, file.path).split('\n').filter((l) => l.trim()).length;
      expect(
        commentLines(file.content),
        `${file.path} documents less than it declares`,
      ).toBeGreaterThan(code);
    }
  });
});

/**
 * Generated files now name a lot of API in their comments — hooks to call, what
 * each returns. A comment that names a hook is a promise, and an invented one is
 * worse than no documentation: the reader trusts it, imports it, and gets a build
 * error in code armemon told them to write. (This test exists because two such
 * names shipped: useNetwork, whose real name is useNetworkStatus, and a dismissAll
 * that never existed.)
 */
describe('documented hooks exist', () => {
  // Read the published type declarations rather than importing the runtime: these
  // packages import react-native, whose ESM node can't parse. The .d.ts is the
  // contract anyway — if a name isn't in there, an app can't import it.
  const exportsOf = async (pkg: string): Promise<Set<string>> => {
    const declaration = await readFile(
      new URL(`../../${pkg}/dist/runtime/index.d.ts`, import.meta.url),
      'utf8',
    );
    const names = new Set<string>();
    for (const [, list] of declaration.matchAll(/export\s*\{([^}]*)\}/g)) {
      for (const part of list.split(',')) {
        const name = part.replace(/\btype\b/, '').split(/\s+as\s+/).pop()?.trim();
        if (name) names.add(name);
      }
    }
    for (const [, name] of declaration.matchAll(
      /export\s+declare\s+(?:function|const|class)\s+(\w+)/g,
    )) {
      names.add(name);
    }
    return names;
  };

  /** Hooks that come from React, React Native, React Navigation or armemon core. */
  const EXTERNAL_HOOKS = new Set([
    'useState', 'useEffect', 'useMemo', 'useCallback', 'useRef', 'useContext',
    'useLayoutEffect', 'useReducer', 'useColorScheme', 'useWindowDimensions',
    'useNavigation', 'useRoute', 'useFocusEffect', 'useIsFocused', 'useLinkTo',
    'useTaskProgress', 'useKitReady',
  ]);

  const entries = combinations.filter(([pkg]) => pkg.startsWith('plugin-'));

  it.each(entries)('%s (%s) names no hook that does not exist', async (pkg, _label, answers) => {
    const wizard = await load(pkg);
    const plan = await wizard.plan(answers, ctx());
    const exported = await exportsOf(pkg);

    for (const file of plan.filesToWrite) {
      const named = new Set(file.content.match(/\buse[A-Z][A-Za-z0-9]*/g) ?? []);
      for (const hook of named) {
        expect(
          exported.has(hook) || EXTERNAL_HOOKS.has(hook),
          `${file.path} names ${hook}(), which ${pkg} does not export`,
        ).toBe(true);
      }
    }
  });
});

/**
 * The placeholder README and `armemon add` have to agree about what an empty
 * platform folder means.
 *
 * init writes windows/README.md when it can't generate the target here, and that
 * README tells the reader to run `armemon add windows` on Windows. If "the folder
 * exists" counted as "the platform is present", that command would adopt a folder
 * containing nothing but its own instructions and generate no project at all — the
 * two features would cancel each other out.
 */
describe('placeholder folders are not projects', () => {
  it('describes the guide as a placeholder, not as the target', async () => {
    const { buildPlatformGuide } = await import('@armemon-library/cli-kit');
    const guide = buildPlatformGuide({
      platform: 'windows',
      appName: 'Demo',
      rnVersion: '0.76.0',
      packageManager: 'npm',
      scaffoldedOn: 'linux',
    });

    expect(guide).toMatch(/placeholder/i);
    // It must point at the command, and the command must be able to tell that this
    // folder holds nothing but this file.
    expect(guide).toContain('npx @armemon-library/cli add windows');
  });
});

/**
 * `armemon add web` replays every configured plugin's plan() to recover the markup
 * and assets the web target needs. It must take ONLY those, never the plan's
 * filesToWrite.
 *
 * Writing them would overwrite files the app author owns and has since edited: a
 * RootNavigator with screens added by create-screen, a store.config with their real
 * slices. It would also scatter a second copy of every slice, since the plan's paths
 * move between armemon versions while the app's imports do not.
 *
 * A behavioural test would need a whole app on disk; this reads the source, which is
 * enough to catch the one-line change that would cause it.
 */
describe('adding a platform never rewrites the app', () => {
  it('the web path consumes contributions and assets, not plan files', async () => {
    const source = await readFile(
      new URL('../src/flows/addPlatform.ts', import.meta.url),
      'utf8',
    );
    const addWeb = source.slice(source.indexOf('async function addWeb'), source.indexOf('/** Adds a native target'));

    expect(addWeb.length).toBeGreaterThan(200);
    // What it may read from a replayed plan.
    expect(addWeb).toContain('htmlContributions');
    expect(addWeb).toContain('filesToCopy');
    // What it must never write.
    expect(addWeb).not.toMatch(/writeGeneratedFiles\([^)]*plan\.filesToWrite/);
    expect(addWeb).not.toMatch(/plans\.flatMap\(\(?\w*\)? ?=> ?\w+\.filesToWrite/);
  });
});

/**
 * The reference screen must never overwrite a real one.
 *
 * `armemon init` writes the layout skeleton AFTER every plugin's plan, so if a user's
 * initial route happens to be "Example", the navigation plan writes
 * src/screens/ExampleScreen/index.tsx and the skeleton would replace their screen
 * with a template. Silent, and nothing else in the suite looks at it.
 */
describe('the layout skeleton yields to real files', () => {
  it('the navigation plan owns ExampleScreen when that is the initial route', async () => {
    const wizard = await load('plugin-navigation');
    const plan = await wizard.plan({ ...navBase, initialRouteName: 'Example' }, ctx());

    expect(plan.filesToWrite.map((f) => f.path)).toContain('src/screens/ExampleScreen/index.tsx');
  });

  it('the init flow filters skeleton paths against what was already written', async () => {
    // Source-level, because the alternative is running the whole flow: the filter is
    // one line and its absence is the entire bug.
    const source = await readFile(new URL('../src/flows/initReactNative.ts', import.meta.url), 'utf8');

    expect(source).toContain('const alreadyWritten = new Set(writtenPaths);');
    expect(source).toMatch(/skeleton\.filter\(\(file\) => !alreadyWritten\.has\(file\.path\)\)/);
  });
});

/**
 * The layout READMEs are written by the init flow, not by a plugin plan, so every
 * guard above is blind to them — and being prose, the .ts-to-.js conversion would
 * not fix a stale extension either. A JavaScript scaffold caught one of these telling
 * the reader to write formatDate.ts.
 */
describe('the layout guidance matches the app language', () => {
  it.each(['components', 'hooks', 'utils'])(
    'the shared/%s README names no TypeScript file in a JavaScript app',
    async (folder) => {
      const { sharedFolderReadme } = await import('../dist/index.js');
      const named = sharedFolderReadme(folder, 'js').match(/[\w./-]+\.tsx?\b/g) ?? [];
      expect(named, `names ${named.join(', ')}`).toEqual([]);
    },
  );

  it('the shared and examples READMEs describe the folders that exist', async () => {
    const { sharedReadme, examplesReadme } = await import('../dist/index.js');

    expect(sharedReadme()).toContain('src/screens/ExampleScreen');
    // The examples folder is only useful if every file in it says how to replace it.
    expect(examplesReadme(DEFAULT_LAYOUT)).toContain('UiKitScreen');
    expect(examplesReadme(DEFAULT_LAYOUT)).toContain('StartupSplash');
    expect(examplesReadme(DEFAULT_LAYOUT)).toContain('runtimeOverrides');
    // It names the managed files it wires into, and those moved out of src/.
    expect(examplesReadme(DEFAULT_LAYOUT)).toContain('armemon/runtime.generated');
  });
});

/**
 * `armemon set` finds a plugin's settings through its manifest, so the manifest and
 * the wizard have to agree: a `settings.file` the wizard never writes, or an export
 * it names differently, makes `set` report "no config" in an app that has one.
 */
describe('manifest settings point at what the wizard writes', () => {
  const settable = [...new Set(combinations.map(([pkg]) => pkg))];

  it.each(settable)('%s', async (pkg) => {
    const manifest = JSON.parse(await readFile(new URL(`../../${pkg}/package.json`, import.meta.url), 'utf8'))
      .armemon as { settings?: { file: string; exportName: string } };
    if (!manifest.settings) return;

    const wizard = await load(pkg);
    const [, , answers] = combinations.find(([name]) => name === pkg)!;
    const plan = await wizard.plan(answers, ctx());
    const written = plan.filesToWrite.find((file) => file.path === `armemon/${manifest.settings!.file}`);

    expect(written, `${pkg} never writes armemon/${manifest.settings.file}`).toBeDefined();
    expect(activeCodeOf(written!.content, written!.path)).toMatch(
      new RegExp(`export const ${manifest.settings.exportName}\\b`),
    );
  });
});

/**
 * init decides what the App entry renders from what plans say they provide. It used
 * to check the plugin id and one of the UI wizard's answers by name, so renaming that
 * answer quietly stopped the welcome screen being themed.
 */
describe('what plans provide', () => {
  it.each(combinations.filter(([pkg]) => pkg === 'plugin-navigation'))(
    '%s (%s) provides the app root, and writes the navigator the App entry renders',
    async (pkg, _label, answers) => {
      const plan = await (await load(pkg)).plan(answers, ctx());
      expect(plan.provides).toContain('app-root');
      expect(plan.filesToWrite.map((file) => file.path)).toContain(
        `${DEFAULT_LAYOUT.managed}/navigation/RootNavigator.tsx`,
      );
    },
  );

  it('the UI plugin provides themed components exactly when its example screen exists', async () => {
    const ui = await load('plugin-ui');
    const withStarter = await ui.plan(uiBase, ctx());
    const without = await ui.plan({ ...uiBase, generateStarterComponents: false }, ctx());

    expect(withStarter.provides).toEqual(['themed-components']);
    expect(withStarter.filesToWrite.some((file) => file.path.endsWith('UiKitScreen.tsx'))).toBe(true);
    expect(without.provides ?? []).toEqual([]);
  });

  it.each(combinations.filter(([pkg]) => !['plugin-navigation', 'plugin-ui'].includes(pkg)))(
    '%s (%s) claims nothing it does not do',
    async (pkg, _label, answers) => {
      const plan = await (await load(pkg)).plan(answers, ctx());
      expect(plan.provides ?? []).toEqual([]);
    },
  );
});
