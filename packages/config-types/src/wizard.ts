/**
 * FILE: wizard.ts
 * PATH: packages/config-types/src/wizard.ts
 *
 * WHAT: The contract every plugin's `./wizard` export implements — the interactive
 *       question flow, plus a pure "plan" step that describes what files/deps/native
 *       edits a plugin wants without doing any I/O itself.
 * WHY:  Splitting `run` (asks questions) from `plan` (pure, describes changes) keeps
 *       every wizard testable without a real filesystem or terminal, and lets the CLI
 *       own all actual writes/installs centrally (single install pass, atomic writes
 *       — nothing touches disk until every selected plugin has finished planning).
 *       `devDependencies` exists alongside `npmDependencies` because Babel plugins,
 *       type stubs and lint configs are build-time-only and putting them in an app's
 *       runtime `dependencies` is wrong; `runtimeConfigContributions` exists because
 *       core's RuntimeConfig has real fields (splash overrides, minimum splash
 *       duration, custom error screen) that a wizard answer needs to reach — without
 *       it the generated runtime config is a fixed two-field object and those answers
 *       are silently discarded. `postInstallSteps` lets a plugin defer real work
 *       (asset generation, native patching) until AFTER the batched install, instead
 *       of the plan() step cheating and shelling out early against packages that
 *       aren't installed yet.
 * HOW:  Plain TypeScript interfaces plus one callback type; no runtime code.
 * WHEN: run()/plan() are invoked sequentially by the CLI's init flow, once per
 *       selected plugin, during `armemon init react-native`; postInstallSteps run
 *       after dependency installation.
 *
 * EXPORTS: WizardContext, PluginInstallPlan, PluginWizard, PostInstallStep,
 *          PostInstallContext, RuntimeConfigContributions, WebContributions, PlanCapability,
 *          GeneratedFile
 * DEPENDS ON: ./packageManager, ./platform
 * USED BY: packages/cli-armemon/src/flows/initReactNative.ts, every plugin's src/wizard/index.ts
 */

import type { PackageManager } from './packageManager.js';
import type { Platform } from './platform.js';
import type { AppLanguage } from './language.js';
import type { AppLayout } from './layout.js';

export interface WizardContext {
  appRoot: string;
  /**
   * The directory the user ran `armemon` from.
   *
   * Distinct from appRoot, and the difference matters for anything the user
   * supplies: appRoot is created part-way through the run, so a file they already
   * have is in cwd, not in the app that doesn't exist yet.
   */
  cwd: string;
  appName: string;
  rnVersion: string;
  packageManager: PackageManager;
  platforms: Platform[];
  /**
   * Whether the app is TypeScript or JavaScript.
   *
   * A wizard should keep AUTHORING TypeScript regardless — the CLI strips types
   * centrally when writing, so a plugin never maintains two copies of a template.
   * Read this only to skip questions that are meaningless in JavaScript (typed
   * route param lists, say), not to change how files are emitted.
   */
  language: AppLanguage;
  /**
   * Command-line flags a wizard may consult instead of prompting.
   *
   * Exists so answers that are otherwise interactive-only can be scripted — which
   * matters beyond convenience: a question no flag can reach is a question no test
   * can exercise, and the splash logo went unverified end-to-end for exactly that
   * reason. A wizard must still work with none of these set.
   */
  flags: Record<string, string | undefined>;
  alreadyAnsweredByOtherPlugins: Record<string, unknown>;
  /**
   * Which zone a generated file belongs in, and where the managed one is.
   *
   * A plan's paths are app-relative strings, so every wizard would otherwise spell
   * `armemon/ui/theme.config.ts` itself — and an app scaffolded before the managed
   * zone moved out of src/ would be edited in the wrong place. Build managed paths
   * with managedPath(layoutOf(ctx), …) and cross-zone imports with specifierFor().
   * Absent means the current layout.
   */
  layout?: AppLayout;
}

/**
 * Fields a plugin wants merged into the app's generated registerRuntimeConfig()
 * call. Deliberately a narrow subset of core's RuntimeConfig: only the values a
 * wizard can decide at scaffold time. Component overrides are expressed as an
 * import spec rather than a component, since codegen emits source text.
 */
export interface RuntimeConfigContributions {
  minSplashDurationMs?: number;
  readyCustom?: boolean;
  readyCustomTimeout?: number;
  splashScreenComponent?: { importName: string; from: string };
  errorScreenComponent?: { importName: string; from: string };
}

export interface PostInstallContext {
  appRoot: string;
  appName: string;
  platforms: Platform[];
  packageManager: PackageManager;
}

export interface PostInstallStep {
  label: string;
  /** Throwing is non-fatal: the flow warns and continues with `fallbackNote`. */
  run(ctx: PostInstallContext): Promise<void>;
  fallbackNote?: string;
}

/**
 * What the web target's Vite config needs from a plugin.
 *
 * Metro runs the app's babel.config.js; Vite's React plugin does not. So anything a
 * plugin makes work through Babel — an import alias, a virtual module — works on
 * iOS and Android and breaks the web build, unless the plugin says it again here.
 * Declarative on purpose: the CLI writes the Vite side, so plugins never ship
 * config source that has to stay valid in someone else's file.
 */
export interface WebContributions {
  /** Import aliases to app-relative folders: `{ '@': 'src' }` makes `@/x` mean `src/x`. */
  aliases?: Record<string, string>;
  /**
   * Virtual modules whose named exports are the variables in an env file at the app
   * root, read at build time: `{ '@env': '.env' }`.
   */
  envModules?: Record<string, string>;
}

/** One file a plan writes, relative to the app root. */
export interface GeneratedFile {
  path: string;
  content: string;
  /**
   * What happens when the app already has a file at `path`.
   *
   *   (unset)    armemon's own file. `init` writes it; `plugin add` writes it when it
   *              is missing or identical and stops when something else is there,
   *              rather than replacing someone's work.
   *   'keep'     a starter the app owns from then on — `.env`. Written only when
   *              missing, by `init` and `plugin add` alike, and never removed.
   *   'replace'  built from the file already there — tsconfig.json with one path
   *              added — so writing it keeps what was in it.
   */
  whenPresent?: 'keep' | 'replace';
}

/**
 * Something a plugin's output lets the CLI build on.
 *
 * - `app-root`: the plan writes the navigator the App entry renders — the managed
 *   zone's navigation/RootNavigator.
 * - `themed-components`: the app can render @armemon-library/ui's Container, Text and
 *   Button, and has the UiKitScreen example that shows them all.
 */
export type PlanCapability = 'app-root' | 'themed-components';

export interface PluginInstallPlan {
  npmDependencies: Record<string, string>;
  /** Build-time-only packages (Babel plugins, type stubs, lint configs). */
  devDependencies?: Record<string, string>;
  filesToWrite: GeneratedFile[];
  /**
   * Files copied verbatim from somewhere on disk into the app — images, fonts,
   * anything binary that `filesToWrite`'s string content can't carry. `from` is
   * absolute or relative to the app root; `to` is relative to the app root.
   */
  filesToCopy?: Array<{ from: string; to: string }>;
  /** Babel plugin entries, merged across every plugin into one babel.config.js. */
  babelPlugins?: string[];
  /** Lines prepended to index.js, in plan order (e.g. gesture-handler's side-effect import). */
  entryPrelude?: string[];
  /** package.json "scripts" entries this plugin needs. */
  packageJsonScripts?: Record<string, string>;
  /** Extra .gitignore entries (e.g. `.env`). */
  gitignoreEntries?: string[];
  /**
   * Values merged into a JSON file the app already has — a path alias in tsconfig.json.
   *
   * Only these keys are touched, so the rest of the file stays as the app has it. init
   * and `plugin add` merge them in; `plugin remove` takes each one back out while it
   * still holds this value, which a whole file in `filesToWrite` could never do.
   */
  jsonMerges?: Array<{ path: string; values: Record<string, unknown> }>;
  /**
   * Markup injected into the web target's index.html.
   *
   * `head` and `bodyStart` land before the app's script tag, so they render before
   * the JS bundle has parsed — which is the only way to get a real pre-JS splash on
   * web, the counterpart to a native cold-start splash.
   */
  htmlContributions?: { head?: string[]; bodyStart?: string[] };
  /** What the web target's Vite config needs to match this plugin's Babel entries. */
  webContributions?: WebContributions;
  /**
   * What this plan's output lets the CLI build on. Declared by the plugin, so the CLI
   * never has to recognise one by its id or read its answers — which it once did, so
   * renaming a wizard question silently stopped the welcome screen being themed.
   */
  provides?: PlanCapability[];
  appEntryContributions?: {
    providerImport: { importName: string; from: string };
    registerInRuntimeConfig: true;
  };
  runtimeConfigContributions?: RuntimeConfigContributions;
  /**
   * What armemon.config should record for this plugin, when that differs from the
   * answers the user gave.
   *
   * armemon.config is a description of the APP, but the answers are a description
   * of the RUN: a `--logo ~/pictures/logo.png` answer is an absolute path on one
   * machine, and writing it verbatim put the operator's home directory into a file
   * the app then commits — meaningless to a teammate and a small privacy leak. A
   * wizard that relocates an input (here, copying the logo into assets/) reports
   * the app-relative result through this field instead.
   *
   * Only the config file uses it; other plugins still see the real answers through
   * ctx.alreadyAnsweredByOtherPlugins.
   */
  recordedAnswers?: Record<string, unknown>;
  postInstallSteps?: PostInstallStep[];
  postInstallNotes?: string[];
  /**
   * Text that, found in the app's native projects, means native code still depends on
   * one of this plan's packages — `Theme.BootSplash` in android's styles.xml. A tool the
   * plugin ran, or a step its notes asked for, edits android/ and ios/ in ways armemon
   * can't undo; `armemon plugin remove` stops while these are there rather than
   * uninstalling a package the native build still needs.
   */
  nativeReferences?: Array<{ marker: string; package: string }>;
  /**
   * What `armemon plugin remove` can't take back out, said to the person removing it:
   * a native project edited by hand following a postInstallNote, a secret in a file
   * the app now owns. Everything armemon wrote itself it removes, or lists as kept.
   */
  removalNotes?: string[];
}

export interface PluginWizard<TAnswers = Record<string, unknown>> {
  pluginId: string;
  intro: string;
  run(ctx: WizardContext): Promise<TAnswers>;
  plan(answers: TAnswers, ctx: WizardContext): Promise<PluginInstallPlan>;
}
