/**
 * FILE: initReactNative.ts
 * PATH: packages/cli-armemon/src/flows/initReactNative.ts
 *
 * WHAT: The full orchestration behind `armemon init react-native` — preflight
 *       checks, app name/RN version/package manager/platform resolution, the RN CLI
 *       shell-out, platform cleanup, Windows/macOS/Web attachment, plugin discovery
 *       and wizard execution, one batched install, all generated writes, runtime
 *       codegen, App.tsx patching, post-install steps, and the summary.
 * WHY:  Keeping this out of commands/init.ts makes it unit-testable without going
 *       through commander's argv machinery.
 * HOW:  Every selected plugin goes through the identical "dynamic-import its
 *       ./wizard default export -> run() -> plan()" pipeline, and nothing touches
 *       disk until every wizard has planned.
 *
 *       Five structural properties this flow now guarantees that it previously
 *       didn't:
 *       1. Nothing can fail after twenty questions for a reason knowable in the
 *          first second — preflight runs immediately after the app name.
 *       2. Cancelling removes a directory this run created, instead of stranding a
 *          half-scaffolded app that then blocks a retry with the same name.
 *       3. A failed Windows/macOS attach is reconciled: the platform is dropped from
 *          armemon.config.ts and its launcher script removed, rather than leaving a
 *          `pnpm windows` that fails days later against a directory that was never
 *          created.
 *       4. Plugin wizards run in topological `dependsOn` order, not array order.
 *       5. Everything a plan can contribute — dev dependencies, Babel entries, entry
 *          prelude lines, gitignore lines, runtime-config values, post-install steps
 *          — is actually applied. Several of those channels exist because the
 *          alternative was a postInstallNote asking the user to edit a file by hand.
 * WHEN: Invoked by commands/init.ts once `armemon init react-native` is parsed.
 *
 * EXPORTS: runInitReactNativeFlow, InitReactNativeOptions
 * DEPENDS ON: @armemon-library/cli-kit, @armemon-library/config-types, execa, semver, node:*
 * USED BY: packages/cli-armemon/src/commands/init.ts
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import semver from 'semver';
import * as clack from '@clack/prompts';
import {
  logger,
  CliError,
  CancelledError,
  runPreflight,
  verifyGeneratedApp,
  assertCommandAvailable,
  promptText,
  promptSelect,
  promptConfirm,
  promptMultiselect,
  withSpinner,
  withOutputStep,
  shellOutToReactNativeCli,
  shellOutToReactNativeWindowsCli,
  shellOutToReactNativeMacosCli,
  resolvePlatformPackageVersion,
  buildWebScaffoldPlan,
  ignoreWebBuildOutput,
  cleanupUnselectedPlatforms,
  discoverPlugins,
  discoverProjectPlugins,
  resolvePackageSubpathUrl,
  resolvePluginSpecifier,
  filterPluginsByPlatform,
  partitionPluginsByReactNative,
  sortPluginsByDependencies,
  writeAppConfig,
  collectDependencies,
  mergeDependencies,
  installDependencies,
  addPackageJsonScripts,
  removePackageJsonScripts,
  buildPlatformGuide,
  buildScreenFiles,
  managedReadme,
  writeNpmrcForPnpm,
  writeNpmrcForMacos,
  writePackageManagerOverrides,
  writeGeneratedFiles,
  copyGeneratedFiles,
  writeRuntimeConfig,
  writeBabelConfig,
  mergeJsonValues,
  prependToAppIndex,
  appendGitignoreEntries,
  applyHtmlContributions,
  writeJestSetup,
  convertFilesToJavaScript,
  removeTypeScriptScaffolding,
  JEST_MOCKABLE_PACKAGES,
  patchAppEntry,
  buildArmemonDependencySpecifier,
  isWorkspacePackage,
  resolveLocalPackageDir,
  patchMetroConfigForLocalPackages,
  setAutoAccept,
  isAutoAcceptEnabled,
  type AppRootChoice,
  type DependencyContribution,
  type DiscoveredPlugin,
  type RuntimeCodegenPlugin,
} from '@armemon-library/cli-kit';
import {
  DEFAULT_LAYOUT,
  EXAMPLES_DIR,
  SCREENS_DIR,
  SHARED_DIR,
  SLICES_DIR,
  managedPath,
  type AppLayout,
} from '@armemon-library/config-types';
import type {
  AppLanguage,
  ArmemonAppConfig,
  Platform,
  PackageManager,
  PluginInstallPlan,
  PluginWizard,
  RuntimeConfigContributions,
  WizardContext,
} from '@armemon-library/config-types';
import {
  DEFAULT_RN_VERSION,
  CATALOG_PACKAGES,
  ALL_PLATFORMS,
  platformBuildableOnHost,
} from '../constants.js';
import { takePlatformPackagesBackOut } from './platformPackages.js';
import { tryPodInstall } from './pods.js';
import { writeJson } from '../jsonOutput.js';

export interface InitReactNativeOptions {
  appName?: string;
  version?: string;
  allAccept?: boolean;
  packageManager?: string;
  language?: string;
  logo?: string;
  platforms?: string;
  plugins?: string;
  dryRun?: boolean;
  json?: boolean;
  verify?: boolean;
  noVerify?: boolean;
  /** The full command reference, generated from the live program by the command layer. */
  commandReference?: string;
  cwd: string;
}

const PACKAGE_MANAGERS: PackageManager[] = ['npm', 'yarn', 'pnpm', 'bun'];

/**
 * This CLI's own directory, used as a resolution root for the built-in plugins.
 * cli-armemon is what depends on them — cli-kit doesn't — so a fallback that
 * resolved from cli-kit's location couldn't find them at all.
 */
const CLI_DIR = path.dirname(fileURLToPath(import.meta.url));

const APP_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9]*$/;

/**
 * Names the React Native CLI refuses.
 *
 * Mirrored here rather than discovered by trying: the RN CLI validates the project
 * name against the JAVA keyword list, because the name becomes an Android package
 * segment. Without this, a name like "Final" or "Native" passed armemon's own
 * check, the user answered every remaining question, and the very first shell-out
 * then failed with "Not a valid name for a project" — after the point where
 * anything could be salvaged. Kept in sync with @react-native-community/cli's
 * reservedNames (Java keywords plus react/react-native).
 */
const RESERVED_APP_NAMES = new Set([
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char',
  'class', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum',
  'extends', 'false', 'final', 'finally', 'float', 'for', 'goto', 'if',
  'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native',
  'new', 'null', 'package', 'private', 'protected', 'public', 'return', 'short',
  'static', 'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw',
  'throws', 'transient', 'true', 'try', 'void', 'volatile', 'while',
  'react', 'reactnative', 'react-native',
]);

function validateAppName(value: string): string | undefined {
  if (!APP_NAME_PATTERN.test(value)) {
    return 'Use letters and numbers only, starting with a letter (matches React Native project-name rules).';
  }
  if (RESERVED_APP_NAMES.has(value.toLowerCase())) {
    return `"${value}" is a reserved word (React Native validates project names against the Java keyword list, since the name becomes an Android package segment) — pick something else.`;
  }
  return undefined;
}

async function resolveAppName(provided: string | undefined): Promise<string> {
  if (provided) {
    const error = validateAppName(provided);
    if (error) throw new CliError(`Invalid app name "${provided}": ${error}`);
    return provided;
  }

  // No static default works here: every --all-accept run in one directory would
  // otherwise collide on the same "MyApp" folder. Needs dynamic content, so it can't
  // live in promptText's generic auto-accept fallback.
  if (isAutoAcceptEnabled()) {
    return `ArmemonApp${Date.now()}`;
  }

  return promptText({
    message: 'What should the app be called?',
    placeholder: 'MyApp',
    validate: validateAppName,
  });
}

async function resolveRnVersion(provided: string | undefined): Promise<string> {
  if (provided) {
    if (provided !== 'latest' && !semver.valid(provided)) {
      throw new CliError(
        `Invalid React Native version "${provided}".`,
        'Pass "latest" or an exact semver like 0.76.0.',
      );
    }
    return provided;
  }

  const choice = await promptSelect({
    message: 'Which React Native version?',
    options: [
      { value: 'latest', label: 'latest (recommended)' },
      { value: 'default', label: `${DEFAULT_RN_VERSION} (verified dependency set available)` },
      { value: 'custom', label: 'custom version' },
    ],
    initialValue: 'latest',
  });

  if (choice === 'default') return DEFAULT_RN_VERSION;
  if (choice === 'latest') return 'latest';

  return promptText({
    message: 'Which version?',
    placeholder: '0.75.4',
    validate: (value) =>
      semver.valid(value) ? undefined : 'Enter an exact semver version, e.g. 0.75.4.',
  });
}

async function resolvePackageManager(provided: string | undefined): Promise<PackageManager> {
  if (provided) {
    if (!PACKAGE_MANAGERS.includes(provided as PackageManager)) {
      throw new CliError(
        `Unknown package manager "${provided}".`,
        `Choose one of: ${PACKAGE_MANAGERS.join(', ')}.`,
      );
    }
    return provided as PackageManager;
  }

  return promptSelect<PackageManager>({
    message: 'Which package manager?',
    options: [
      { value: 'pnpm', label: 'pnpm (recommended)' },
      { value: 'npm', label: 'npm' },
      { value: 'yarn', label: 'yarn' },
      { value: 'bun', label: 'bun' },
    ],
    initialValue: 'pnpm',
  });
}

/**
 * TypeScript or JavaScript.
 *
 * Worth asking because React Native gives no choice: its template has been
 * TypeScript-only since 0.71 and `--template` takes a third-party package, so a
 * JavaScript user otherwise receives a TypeScript project and has to dismantle it.
 * armemon converts instead — see cli-kit's languageConversion.ts.
 */
async function resolveLanguage(provided: string | undefined): Promise<AppLanguage> {
  if (provided) {
    const normalized = provided.toLowerCase();
    if (normalized === 'ts' || normalized === 'typescript') return 'typescript';
    if (normalized === 'js' || normalized === 'javascript') return 'javascript';
    throw new CliError(
      `Unknown language "${provided}".`,
      'Pass "ts"/"typescript" or "js"/"javascript".',
    );
  }

  return promptSelect<AppLanguage>({
    message: 'TypeScript or JavaScript?',
    options: [
      { value: 'typescript', label: 'TypeScript (recommended — React Native\'s own default)' },
      {
        value: 'javascript',
        label: 'JavaScript',
        hint: "React Native ships no JS template; armemon strips the TypeScript for you",
      },
    ],
    initialValue: 'typescript',
  });
}

function parsePlatformList(raw: string): Platform[] {
  const requested = raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  const unknown = requested.filter((entry) => !ALL_PLATFORMS.includes(entry as Platform));
  if (unknown.length > 0) {
    throw new CliError(
      `Unknown platform(s): ${unknown.join(', ')}.`,
      `Valid platforms are: ${ALL_PLATFORMS.join(', ')}.`,
    );
  }
  if (requested.length === 0) {
    throw new CliError('--platforms was empty.', `Pass at least one of: ${ALL_PLATFORMS.join(', ')}.`);
  }

  return [...new Set(requested)] as Platform[];
}

/**
 * Which platforms to target.
 *
 * All five are OFFERED everywhere, including Windows and macOS on a Linux host.
 * They were previously hidden, on the reasoning that their attach step can only run
 * on its own OS — but that conflates generating a target with building one. Wanting
 * a macos/ folder scaffolded from Linux so a teammate or CI builds it on a Mac is a
 * perfectly ordinary thing to want, and iOS is already offered on Linux for exactly
 * the same reason (the RN CLI scaffolds ios/ regardless of host).
 *
 * What makes offering them safe is the reconciliation after the attach step: if the
 * tool fails, the platform is dropped from armemon.config.ts and its launcher script
 * removed, so a failure costs a warning rather than a lying config. Selecting one on
 * a foreign host is a real choice with a real caveat, so the caveat is in the hint
 * and in a warning — not in a hard block.
 *
 * --all-accept targets ALL of them, not just the ones this host can build. The
 * point of scaffolding a target is to commit it and build it elsewhere: macOS
 * attaches cleanly from Linux (verified — react-native-macos-init picks its own
 * compatible version and writes the whole Xcode project), and a repo that carries
 * every target from day one is the workflow people actually want.
 *
 * Windows is the exception, and it fails honestly rather than being pre-filtered:
 * react-native-windows' CLI plugin shells out to pwsh.exe and dotnet.exe just to
 * LOAD, so on any non-Windows host `init-windows` never registers as a command.
 * When that happens the platform is dropped from the config, its script removed and
 * its dependency taken back out, so the app is exactly as if it had never been
 * asked for — plus a warning saying where to run it instead.
 */
async function resolvePlatforms(provided: string | undefined): Promise<Platform[]> {
  const buildCaveat = (platforms: Platform[]): string =>
    [
      platforms.includes('macos') ? 'macOS targets need a Mac with Xcode to build' : null,
      platforms.includes('windows') ? 'Windows targets need Windows with Visual Studio to build' : null,
    ]
      .filter(Boolean)
      .join('; ');

  if (provided) {
    const requested = parsePlatformList(provided);
    const foreign = requested.filter((platform) => !platformBuildableOnHost(platform));
    if (foreign.length > 0) {
      logger.warn(
        `Targeting ${foreign.join(' and ')} from ${process.platform}: ${buildCaveat(foreign)}. The target still gets scaffolded here — if its attach tool can't run, the platform is dropped from your config and its script removed.`,
      );
    }
    return requested;
  }

  if (isAutoAcceptEnabled()) {
    const foreign = ALL_PLATFORMS.filter((platform) => !platformBuildableOnHost(platform));
    if (foreign.length > 0) {
      logger.info(
        `Targeting every platform, including ${foreign.join(' and ')}: ${buildCaveat(foreign)}, so those get scaffolded here and built after you clone. Pass --platforms to pick a subset.`,
      );
    }
    return [...ALL_PLATFORMS];
  }

  const labels: Record<Platform, string> = {
    ios: 'iOS',
    android: 'Android',
    web: 'Web (react-native-web + Vite)',
    windows: 'Windows (react-native-windows)',
    macos: 'macOS (react-native-macos)',
  };

  const selected = await promptMultiselect<Platform>({
    message: 'Which platforms do you want to target?',
    options: ALL_PLATFORMS.map((platform) => ({
      value: platform,
      label: labels[platform],
      hint: platformBuildableOnHost(platform)
        ? undefined
        : `scaffolds here — needs ${platform === 'macos' ? 'macOS' : 'Windows'} to build`,
    })),
    initialValues: ['ios', 'android'],
    required: true,
  });

  const foreign = selected.filter((platform) => !platformBuildableOnHost(platform));
  if (foreign.length > 0) {
    logger.warn(
      `${buildCaveat(foreign)}. The target still gets scaffolded here — if its attach tool can't run on ${process.platform}, the platform is dropped from your config and its script removed.`,
    );
  }

  return selected;
}

async function selectPlugins(
  catalog: DiscoveredPlugin[],
  provided: string | undefined,
  cwd: string,
  incompatible: Array<{ plugin: DiscoveredPlugin; rnMin: string }> = [],
  rnVersion = 'latest',
): Promise<DiscoveredPlugin[]> {
  if (provided !== undefined) {
    const requested = provided
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);

    const byId = new Map(catalog.map((plugin) => [plugin.manifest.pluginId, plugin]));
    const byPackage = new Map(catalog.map((plugin) => [plugin.packageName, plugin]));

    const selected: DiscoveredPlugin[] = [];
    for (const entry of requested) {
      // Named on purpose, so "isn't available" would be the wrong thing to say — and
      // checked first, so resolving the package by name below can't let it back in.
      const tooNew = incompatible.find(
        ({ plugin }) => plugin.manifest.pluginId === entry || plugin.packageName === entry,
      );
      if (tooNew) {
        throw new CliError(
          `${tooNew.plugin.manifest.displayName} needs React Native ${tooNew.rnMin} or newer, and this app is getting ${rnVersion}.`,
          `Pass --rn-version ${tooNew.rnMin} or newer, or leave "${entry}" out of --plugins.`,
        );
      }

      let found = byId.get(entry) ?? byPackage.get(entry);

      // An explicitly named package is worth one resolution attempt even if it
      // wasn't discovered — it may be installed somewhere the project's own
      // package.json doesn't declare, e.g. a monorepo root.
      if (!found && entry.includes('/')) {
        const [discovered] = await discoverPlugins([entry], {
          resolveFrom: [cwd, CLI_DIR],
        }).catch(() => []);
        found = discovered;
      }

      if (!found) {
        throw new CliError(
          `"${entry}" isn't an available plugin.`,
          `Available: ${catalog.map((plugin) => plugin.manifest.pluginId).join(', ')}. Run "armemon list" to see them, or install a third-party plugin here first.`,
        );
      }
      if (!selected.includes(found)) selected.push(found);
    }
    return selected;
  }

  const selectedPackageNames = await promptMultiselect({
    message: 'Which plugins would you like to add?',
    options: catalog.map((plugin) => ({
      value: plugin.packageName,
      label: plugin.manifest.required
        ? `${plugin.manifest.displayName} — ${plugin.manifest.description} (core, on by default)`
        : `${plugin.manifest.displayName} — ${plugin.manifest.description}`,
    })),
    initialValues: catalog
      .filter((plugin) => plugin.manifest.required)
      .map((plugin) => plugin.packageName),
    required: false,
    allAcceptSelectsAll: true,
  });

  return catalog.filter((plugin) => selectedPackageNames.includes(plugin.packageName));
}

interface WizardRunResult {
  pluginId: string;
  answers: Record<string, unknown>;
  plan: PluginInstallPlan;
}

async function runWizardForPackage(
  packageName: string,
  ctx: WizardContext,
  resolveFrom: string[],
): Promise<WizardRunResult> {
  // Resolved to a file URL rather than imported by bare specifier: a bare import
  // resolves against THIS module's context (the CLI's own install), so a plugin
  // living in the user's project was discovered and then failed to load.
  const wizardUrl = resolvePackageSubpathUrl(packageName, 'wizard', { resolveFrom });

  let mod: { default?: PluginWizard };
  try {
    mod = (await import(wizardUrl)) as { default?: PluginWizard };
  } catch (error) {
    throw new CliError(
      `Couldn't load the wizard for "${packageName}".`,
      `Its "./wizard" export failed to import. (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  const wizard = mod.default;
  if (!wizard || typeof wizard.run !== 'function' || typeof wizard.plan !== 'function') {
    throw new CliError(
      `"${packageName}/wizard" doesn't default-export a valid PluginWizard.`,
      'It needs a default export with pluginId, intro, run() and plan().',
    );
  }

  logger.step(wizard.intro);

  const answers = await wizard.run(ctx);
  const plan = await wizard.plan(answers, ctx);

  return { pluginId: wizard.pluginId, answers: answers as Record<string, unknown>, plan };
}

/**
 * The React Native version the template really installed — 0.76.3, not the "latest"
 * that may have been typed. Platform packages pair against it.
 */
async function installedReactNativeVersion(appRoot: string, requested: string): Promise<string> {
  const pkg = JSON.parse(await fs.readFile(path.join(appRoot, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  return pkg.dependencies?.['react-native']?.replace(/^[^0-9]*/, '') ?? requested;
}

/**
 * The READMEs that make src/shared/ self-explanatory.
 *
 * They are placeholders first — git cannot commit an empty folder, so without a file
 * the structure would not survive the first clone — and guidance second. The rule
 * they all state is the one that keeps a codebase from silting up: a thing moves here
 * the moment a SECOND screen needs it, not before.
 */
export function sharedReadme(): string {
  return `# shared

Code more than one screen uses. Anything only one screen uses belongs in that
screen's own folder instead — see ${SCREENS_DIR}/ExampleScreen for the shape.

    components/   UI used by more than one screen
    hooks/        state and data loading used by more than one screen
    utils/        pure functions, with their tests beside them

The rule: something moves here the moment a SECOND screen needs it. Not before —
guessing what will be shared is how you end up with a folder of things used once.

Other folders appear here as you add features. Selecting the Redux plugin creates
${SLICES_DIR}/, for example.
`;
}

export function sharedFolderReadme(folder: string, extension: string): string {
  const guide: Record<string, string> = {
    components: `Buttons, cards, layout wrappers — anything rendered by more than one
screen. A component used by exactly one screen belongs in that screen's own
components/ folder, where it is easier to delete along with the screen.

If you selected the UI plugin, check what it already gives you before writing a
button: ${EXAMPLES_DIR}/UiKitScreen lists every component, prop and hook.`,
    hooks: `Hooks used by more than one screen — session state, a data fetcher, a
subscription. Keep hooks that only serve one screen next to that screen.

Name them useSomething, and prefer returning data over returning setters.`,
    utils: `Pure functions: formatting, parsing, validation, small calculations. If it
touches React, it is a hook; if it touches the network, it probably belongs in a
service module rather than here.

Keep each test beside its source — formatDate.${extension} next to
formatDate.test.${extension} — so a file and its proof move together.`,
  };

  return `# shared / ${folder}

${guide[folder] ?? ''}

This file is a placeholder so the folder can be committed while it is empty. Delete
it once there is something here.
`;
}

/**
 * What src/armemon-examples/ is, and how to get rid of each thing in it.
 *
 * The folder's value is that it is deletable, and that only holds if every file in it
 * says what to do instead. Otherwise "examples" becomes a folder nobody dares touch.
 */
export function examplesReadme(layout: AppLayout): string {
  return `# armemon-examples

armemon's stock parts. None of this is your app — read it, take what is useful, and
delete the rest.

**UiKitScreen** — every component, prop and hook the UI plugin ships, with the
options written out. Nothing imports it. Render it from one of your screens for a
minute if you want to see it, then delete the file.

**StartupSplash** — what is on screen while startup tasks run. This one IS wired up:
${managedPath(layout, 'runtime.generated')} imports it. To use your own instead, point
runtimeOverrides at it in ${managedPath(layout, 'runtime.config')}:

    import MySplash from '../screens/MySplashScreen';

    export const runtimeOverrides = {
      SplashScreenComponent: MySplash,
    };

Then delete StartupSplash. Nothing else refers to it.

Deleting the whole folder is fine once both are handled.
`;
}

function pickAppRoot(hasNavigation: boolean): AppRootChoice {
  // Without a navigator the app opens on the welcome screen, which renders itself
  // themed when the UI plugin is present — so the theme is still visible on first
  // run without the app root pointing into src/armemon-examples/, a folder the user
  // is invited to delete.
  return hasNavigation ? 'navigation' : 'welcome';
}

export async function runInitReactNativeFlow(options: InitReactNativeOptions): Promise<void> {
  // --json means a script is reading stdout, so nothing may ask a question: a prompt
  // drawn there corrupts the JSON, and without a terminal it can't be answered at all.
  // Every other command already treats --json this way.
  const allAccept = options.allAccept === true || options.json === true;
  setAutoAccept(allAccept);

  const quiet = options.json === true;
  if (!quiet) clack.intro('armemon — React Native app scaffolding');

  const appName = await resolveAppName(options.appName);
  const appRoot = path.join(options.cwd, appName);

  // Everything knowable up front, before twenty more questions.
  const preExisting = await runPreflight({ targetDir: appRoot });

  const rnVersion = await resolveRnVersion(options.version);
  const packageManager = await resolvePackageManager(options.packageManager);
  // Straight after choosing it, not a question later: a missing package manager is
  // knowable now, and every answer given after this point would be wasted.
  await assertCommandAvailable(
    packageManager,
    `Install ${packageManager}, or re-run with --pm npm.`,
  );
  const language = await resolveLanguage(options.language);
  const platforms = await resolvePlatforms(options.platforms);

  // Built-in catalog plus any armemon plugin the user installed in the directory
  // they're scaffolding from. A third-party plugin needs no registration anywhere:
  // an "armemon" field in its package.json is the whole contract.
  const builtIns = await discoverPlugins(CATALOG_PACKAGES, {
    resolveFrom: [options.cwd, CLI_DIR],
  });
  const projectPlugins = (await discoverProjectPlugins(options.cwd)).filter(
    (plugin) => !builtIns.some((builtIn) => builtIn.manifest.pluginId === plugin.manifest.pluginId),
  );
  if (projectPlugins.length > 0) {
    logger.info(
      `Found ${projectPlugins.length} plugin(s) in this project: ${projectPlugins.map((plugin) => plugin.manifest.pluginId).join(', ')}`,
    );
  }

  // A plugin that declares a newer React Native than this app will get is left out
  // of the catalog and named, rather than installed into an app it can't work in.
  const { compatible, incompatible } = partitionPluginsByReactNative(
    filterPluginsByPlatform([...builtIns, ...projectPlugins], platforms),
    rnVersion,
  );
  for (const { plugin, rnMin } of incompatible) {
    logger.warn(
      `Leaving out ${plugin.manifest.displayName}: it needs React Native ${rnMin} or newer, and this app is getting ${rnVersion}.`,
    );
  }
  const catalog = sortPluginsByDependencies(compatible);

  // Sorted AFTER selection, not just on the catalog: --plugins navigation,redux
  // returns them in the order the user typed, and navigation's sample-auth flow
  // reads Redux's answers, so running it first would silently lose them.
  const selectedPlugins = sortPluginsByDependencies(
    await selectPlugins(catalog, options.plugins, options.cwd, incompatible, rnVersion),
  );

  if (options.dryRun) {
    if (options.json) {
      writeJson({
        ok: true,
        dryRun: true,
        appName,
        appRoot,
        rnVersion,
        packageManager,
        language,
        platforms,
        plugins: selectedPlugins.map((plugin) => plugin.manifest.pluginId),
      });
      return;
    }

    logger.info('Dry run — nothing was written.');
    logger.info(`App:       ${appName} (${appRoot})`);
    logger.info(`RN:        ${rnVersion}`);
    logger.info(`Manager:   ${packageManager}`);
    logger.info(`Language:  ${language}`);
    logger.info(`Platforms: ${platforms.join(', ')}`);
    logger.info(
      `Plugins:   ${selectedPlugins.map((plugin) => plugin.manifest.pluginId).join(', ') || '(none)'}`,
    );
    clack.outro('Dry run complete.');
    return;
  }

  if (!allAccept && !options.plugins) {
    const proceed = await promptConfirm({
      message: `Scaffold ${appName} — React Native ${rnVersion}, ${packageManager}, platforms: ${platforms.join(', ')}?`,
      initialValue: true,
    });
    if (!proceed) throw new CancelledError();
  }

  // Before anything expensive. A --logo typo used to surface from the splash wizard,
  // several minutes in, after the native projects existed — leaving a half-built app
  // behind and no obvious way to tell it was half-built.
  if (options.logo) {
    const candidates = [path.resolve(options.cwd, options.logo), path.resolve(options.logo)];
    const found = await Promise.all(
      candidates.map((candidate) =>
        fs
          .access(candidate)
          .then(() => true)
          .catch(() => false),
      ),
    );
    if (!found.some(Boolean)) {
      throw new CliError(
        `Couldn't find the logo "${options.logo}".`,
        `Looked in ${options.cwd}. Pass a path relative to where you are now, and nothing will be created until it resolves.`,
      );
    }
  }

  let createdAppDir = false;

  // Ctrl-C while React Native's CLI or the package manager is running used to end the
  // process on the spot — Node's default for SIGINT — so none of the clean-up below
  // ran, and a half-created app blocked the next attempt under the same name. Now the
  // first Ctrl-C lets the running step stop (the child gets the signal too) and takes
  // the same path as a cancelled prompt; a second one quits at once.
  let interrupted = false;
  const onInterrupt = () => {
    if (interrupted) process.exit(130);
    interrupted = true;
    logger.warn('Stopping — press Ctrl-C again to quit now, without cleaning up.');
  };
  /** Between steps: a step with no child process to stop finishes, then this ends the run. */
  const stopIfInterrupted = () => {
    if (interrupted) throw new CancelledError();
  };
  process.on('SIGINT', onInterrupt);

  try {
    await withOutputStep('Scaffolding React Native app…', () =>
      shellOutToReactNativeCli({ appName, version: rnVersion, cwd: options.cwd }),
    );
    createdAppDir = true;
    stopIfInterrupted();

    await cleanupUnselectedPlatforms(appRoot, platforms);

    if (language === 'javascript') {
      // Before the dependency merge, so the TypeScript devDependencies are never
      // downloaded rather than installed and then orphaned.
      const removed = await removeTypeScriptScaffolding(appRoot);
      logger.info(
        `JavaScript app — removed ${removed.removedFiles.join(', ')} and ${removed.removedDependencies.length} TypeScript devDependencies that React Native's template installs.`,
      );
    }

    let webScaffoldPlan: ReturnType<typeof buildWebScaffoldPlan> | undefined;
    let webScaffoldInputs: { react: string; dedupe: string[] } | undefined;
    if (platforms.includes('web')) {
      // react-dom must match the app's actual "react" version exactly — read it from
      // the RN CLI's own just-written package.json rather than guessing, since
      // "latest" makes it unknowable ahead of time.
      const scaffoldedPkg = JSON.parse(
        await fs.readFile(path.join(appRoot, 'package.json'), 'utf8'),
      ) as { dependencies?: Record<string, string> };
      // The same "shared singleton" set the generated Jest resolver pins: anything
      // a file:-linked @armemon-library/* package imports must resolve to exactly one copy.
      const dedupe = [
        'react',
        'react-dom',
        'react-native',
        'react-native-web',
        ...selectedPlugins.flatMap((plugin) => plugin.manifest.peerPackages ?? []),
      ].filter((name) => !name.startsWith('@armemon-library/'));

      webScaffoldInputs = { react: scaffoldedPkg.dependencies?.react ?? 'latest', dedupe: [...new Set(dedupe)] };
      // Built now for its dependencies; its files are built again once every plugin
      // has planned, because the Vite config carries what they contribute.
      webScaffoldPlan = buildWebScaffoldPlan(webScaffoldInputs.react, webScaffoldInputs.dedupe);
    }

    const appConfig: ArmemonAppConfig = {
      appName,
      rnVersion,
      platforms: [...platforms],
      packageManager,
      language,
      plugins: {},
    };
    await writeAppConfig(appRoot, appConfig);

    const wizardCtx: WizardContext = {
      appRoot,
      cwd: options.cwd,
      appName,
      rnVersion,
      packageManager,
      platforms,
      language,
      flags: { logo: options.logo },
      alreadyAnsweredByOtherPlugins: {},
      // A brand-new app always gets the current layout; only apps scaffolded before
      // the managed zone moved to the root still read as legacy.
      layout: DEFAULT_LAYOUT,
    };

    // Every path actually written, after any language conversion renamed it — the
    // list verification checks against at the end.
    const writtenPaths: string[] = [];

    // Every generated file goes through here. Generators emit TypeScript
    // unconditionally — including third-party ones, which is the point — and the
    // conversion to JavaScript happens once, at the boundary, so no plugin author
    // maintains two copies of a template.
    const writeFiles = async (files: PluginInstallPlan['filesToWrite']): Promise<void> => {
      let converted = files;
      if (language === 'javascript') {
        const result = await convertFilesToJavaScript(files);
        if (result.dropped.length > 0) {
          logger.info(`Skipped ${result.dropped.join(', ')} — type-only, nothing to emit in JavaScript.`);
        }
        converted = result.files;
      }
      // A file the app owns once it exists is never written over — see GeneratedFile.
      const writable: typeof converted = [];
      for (const file of converted) {
        const present = await fs.access(path.join(appRoot, file.path)).then(() => true, () => false);
        if (file.whenPresent === 'keep' && present) continue;
        writable.push(file);
      }
      await writeGeneratedFiles(appRoot, writable, { layout: DEFAULT_LAYOUT });
      writtenPaths.push(...converted.map((file) => file.path));
    };

    const gitignoreEntriesForWeb: string[] = [];
    /** What a JSON merge couldn't do safely, said at the end with the other notes. */
    const postInstallNotesFromMerges: string[] = [];
    const collectedPlans: PluginInstallPlan[] = [];
    /** The plugin each entry of collectedPlans came from. */
    const collectedIds: string[] = [];
    const contributions: DependencyContribution[] = [];
    let hasNavigation = false;
    let hasUiExample = false;

    for (const plugin of selectedPlugins) {
      // Project first so a locally installed plugin wins over a same-named built-in.
      const { pluginId, answers, plan } = await runWizardForPackage(plugin.packageName, wizardCtx, [
        options.cwd,
        CLI_DIR,
      ]);

      collectedPlans.push(plan);
      collectedIds.push(pluginId);
      contributions.push({
        source: pluginId,
        dependencies: plan.npmDependencies,
        devDependencies: plan.devDependencies,
      });
      wizardCtx.alreadyAnsweredByOtherPlugins[pluginId] = answers;
      // recordedAnswers, when a wizard supplies it, is the app-relative version of
      // what the user typed — see PluginInstallPlan.recordedAnswers. Other plugins
      // above still get the raw answers.
      appConfig.plugins[pluginId] = plan.recordedAnswers ?? answers;
      // Re-written after each wizard so a crash still leaves an accurate record.
      await writeAppConfig(appRoot, appConfig);

      // Read from what the plan says it provides, not from the plugin's id or its
      // answers: those are the plugin's business, and renaming one silently changed
      // what the App entry rendered.
      if (plan.provides?.includes('app-root')) hasNavigation = true;
      if (plan.provides?.includes('themed-components')) hasUiExample = true;
    }

    if (webScaffoldPlan) {
      contributions.push({ source: 'web target', dependencies: webScaffoldPlan.npmDependencies });
    }
    // Why the Windows target can't be attached in this run, when it can't. Decided
    // before the install, so a package nothing will use is never downloaded.
    let windowsUnavailable: string | null = null;
    if (platforms.includes('windows')) {
      if (process.platform !== 'win32') {
        // react-native-windows' CLI plugin looks for pwsh.exe and dotnet.exe just to
        // load, so "init-windows" can't run here. Installing the package anyway only
        // meant taking it back out again afterwards.
        windowsUnavailable = `Windows can't be generated on ${process.platform}: react-native-windows' CLI plugin looks for pwsh.exe and dotnet.exe just to load, so "init-windows" never registers as a command. Everything else in the app is ready for the target, and windows/README.md explains how to finish it — on Windows, "armemon add windows" does the whole thing in one command.`;
      } else {
        // react-native-windows must be installed BEFORE "init-windows" exists as a
        // command — that subcommand is contributed by its own CLI plugin. The release
        // is asked of the registry against the React Native this app really got,
        // the same way `armemon add windows` does: guessing `^<version>` failed
        // outright whenever React Native was newer than react-native-windows.
        const installedRn = await installedReactNativeVersion(appRoot, rnVersion);
        try {
          const resolved = await withSpinner(
            `Finding the react-native-windows release for React Native ${installedRn}…`,
            () => resolvePlatformPackageVersion('react-native-windows', installedRn),
          );
          if (!resolved) {
            windowsUnavailable = `No react-native-windows release pairs with React Native ${installedRn} yet, so the Windows target was skipped. Run "armemon add windows" once one is published.`;
          } else {
            if (resolved.behind) {
              logger.warn(
                `react-native-windows ${resolved.version} is the newest release, and it targets an older React Native than your ${installedRn}. The build normally still works; expect a peer-dependency warning.`,
              );
            }
            contributions.push({
              source: 'windows target',
              dependencies: { 'react-native-windows': resolved.range },
            });
          }
        } catch (error) {
          windowsUnavailable = `Couldn't ask the npm registry which react-native-windows release pairs with React Native ${installedRn}, so the Windows target was skipped. Run "armemon add windows" to add it. (${error instanceof Error ? error.message.split('\n')[0] : String(error)})`;
        }
      }
    }

    // How the app depends on the @armemon-library/* runtime packages depends on where this
    // CLI is running from: a registry range when it was installed from npm, a file:
    // link when it is this monorepo's own source (see buildArmemonDependencySpecifier).
    // cli-kit is NOT among them: it is Node-only (execa, chalk, clack) and never
    // reaches the app bundle, so forcing it into every scaffolded app's dependencies
    // only bloated the install.
    // Resolved from the CLI, which depends on every one of them, rather than from
    // cli-kit, which depends on none: under pnpm dlx or Yarn PnP nothing is hoisted,
    // and resolving from cli-kit found none of them.
    const fromCli = { resolveFrom: [CLI_DIR] };
    const linkedLocally = isWorkspacePackage('@armemon-library/core', fromCli);
    const firstPartyPlugins = selectedPlugins.filter((plugin) =>
      plugin.packageName.startsWith('@armemon-library/'),
    );
    const thirdPartyPlugins = selectedPlugins.filter(
      (plugin) => !plugin.packageName.startsWith('@armemon-library/'),
    );

    // Declared the same way the host project declares them, so a locally linked
    // plugin stays linked instead of becoming a registry range that doesn't exist.
    const thirdPartyDependencies: Record<string, string> = {};
    for (const plugin of thirdPartyPlugins) {
      thirdPartyDependencies[plugin.packageName] = await resolvePluginSpecifier(
        plugin.packageName,
        options.cwd,
      );
    }
    if (Object.keys(thirdPartyDependencies).length > 0) {
      contributions.push({ source: 'third-party plugins', dependencies: thirdPartyDependencies });
    }

    // @armemon-library/core is a dependency of THIS package even though the CLI never
    // imports it: an installed CLI has to be able to resolve core to learn which
    // version it shipped with, and nothing else in the tree pulls it in. Without
    // that, a published scaffold would fall back to a floating "latest".
    const localArmemonPackages = [
      '@armemon-library/core',
      ...firstPartyPlugins.map((plugin) => plugin.packageName),
    ];
    const localPackageOverrides: Record<string, string> = {};
    const localDependencies: Record<string, string> = {};
    for (const packageName of localArmemonPackages) {
      const specifier = buildArmemonDependencySpecifier(packageName, fromCli);
      if (specifier === 'latest') {
        logger.warn(
          `Couldn't find ${packageName} next to this CLI, so the app depends on its "latest" release rather than the version this CLI was published with. Pin it in package.json if the two drift apart.`,
        );
      }
      localDependencies[packageName] = specifier;
      // Overrides exist to force every copy onto the one on disk. With published
      // packages the registry already resolves a single compatible version, and
      // pinning them here would only stop the app from taking a patch release.
      if (linkedLocally) localPackageOverrides[packageName] = specifier;
    }
    // cli-kit and config-types still need overrides even though neither is a
    // runtime dependency of the app: every plugin declares them in its own
    // package.json with a bare "*" range, which pnpm's strict resolver tries to
    // fetch from the real registry (and 404s on) rather than satisfying from a
    // hoisted sibling. config-types is additionally a devDependency here because
    // the generated armemon.config.ts imports its type.
    if (linkedLocally) {
      for (const support of ['@armemon-library/cli-kit', '@armemon-library/config-types']) {
        localPackageOverrides[support] = buildArmemonDependencySpecifier(support, fromCli);
      }
    }
    contributions.push({
      source: 'armemon runtime',
      dependencies: localDependencies,
      devDependencies: {
        '@armemon-library/config-types': buildArmemonDependencySpecifier('@armemon-library/config-types', fromCli),
        // The React Native template ships a jest.config.js and a test but no Jest
        // type declarations, so `expect` is an unresolved name under tsc — in the
        // template's own test file, before anyone writes one of their own. Dropped
        // again below for JavaScript apps, along with every other @types package.
        '@types/jest': '^29.5.14',
      },
    });

    const collected = collectDependencies(contributions);

    // @types/* packages only serve a type checker. Filtered centrally rather than in
    // each plugin, for the same reason the TypeScript-to-JavaScript conversion is
    // central: a plugin author declares what their feature needs and never has to
    // branch on the app's language.
    if (language === 'javascript') {
      for (const name of Object.keys(collected.devDependencies)) {
        if (name.startsWith('@types/')) delete collected.devDependencies[name];
      }
    }
    for (const conflict of collected.conflicts) {
      logger.warn(
        `${conflict.packageName}: ${conflict.requests.map((r) => `${r.source} wants ${r.version}`).join(', ')} — installing ${conflict.resolved}.`,
      );
    }

    const platformScripts: Record<string, string> = {};
    if (platforms.includes('web')) {
      // The config lives in web/, keeping everything web-related in one folder the
      // way android/ and ios/ are. The extension has to follow the app's language:
      // the TypeScript-to-JavaScript conversion renames the config file, and a
      // script still pointing at .ts fails with "Could not resolve
      // web/vite.config.ts" the first time the user runs `npm run web`.
      const viteConfig = `web/vite.config.${language === 'javascript' ? 'js' : 'ts'}`;
      platformScripts.web = `vite --config ${viteConfig}`;
      platformScripts['web:build'] = `vite build --config ${viteConfig}`;
    }
    if (platforms.includes('windows')) platformScripts.windows = 'react-native run-windows';
    if (platforms.includes('macos')) platformScripts.macos = 'react-native run-macos';
    for (const plan of collectedPlans) {
      Object.assign(platformScripts, plan.packageJsonScripts ?? {});
    }
    if (Object.keys(platformScripts).length > 0) {
      await addPackageJsonScripts(appRoot, platformScripts);
    }

    if (platforms.includes('web')) {
      // Build output, not source.
      gitignoreEntriesForWeb.push('web/dist/');
    }

    await mergeDependencies(appRoot, collected.dependencies, collected.devDependencies);
    await writePackageManagerOverrides(appRoot, packageManager, localPackageOverrides);

    if (packageManager === 'pnpm') await writeNpmrcForPnpm(appRoot);
    if (platforms.includes('macos')) await writeNpmrcForMacos(appRoot);

    // One composed babel.config.js from every plugin's entries, rather than each
    // step overwriting the file or asking the user to edit it.
    const babelPlugins = collectedPlans.flatMap((plan) => plan.babelPlugins ?? []);
    if (babelPlugins.length > 0) await writeBabelConfig(appRoot, babelPlugins);

    const entryPrelude = collectedPlans.flatMap((plan) => plan.entryPrelude ?? []);
    if (entryPrelude.length > 0) await prependToAppIndex(appRoot, entryPrelude);

    const gitignoreEntries = [
      ...collectedPlans.flatMap((plan) => plan.gitignoreEntries ?? []),
      ...gitignoreEntriesForWeb,
    ];
    if (gitignoreEntries.length > 0) await appendGitignoreEntries(appRoot, gitignoreEntries);

    stopIfInterrupted();
    await withOutputStep('Installing dependencies…', () =>
      installDependencies(appRoot, packageManager, {
        onRetry: (error) =>
          logger.warn(`Install failed, retrying once. (${error.message.split('\n')[0]})`),
      }),
    );
    stopIfInterrupted();

    // Windows/macOS attachment must run AFTER the install: both tools need
    // react-native physically present in node_modules, and Windows also needs its
    // own package installed for `init-windows` to exist as a command at all.
    const attachedPlatforms = new Set(platforms);

    if (platforms.includes('windows') && windowsUnavailable !== null) {
      attachedPlatforms.delete('windows');
      logger.warn(windowsUnavailable);
    } else if (platforms.includes('windows')) {
      try {
        await withOutputStep('Attaching Windows target…', () =>
          shellOutToReactNativeWindowsCli({ appRoot }),
        );
      } catch (error) {
        attachedPlatforms.delete('windows');
        logger.warn(
          `Windows target setup failed, so it has been removed from armemon.config, its script dropped and react-native-windows taken back out. Run "armemon add windows" inside ${appName} to retry. (${error instanceof Error ? error.message : String(error)})`,
        );
      }
    }

    if (platforms.includes('macos')) {
      try {
        await withOutputStep('Attaching macOS target…', () =>
          shellOutToReactNativeMacosCli({ appRoot }),
        );
      } catch (error) {
        attachedPlatforms.delete('macos');
        logger.warn(
          `macOS target setup failed, so it has been removed from armemon.config.ts and the "macos" script dropped — react-native-macos may not have a release matching React Native ${rnVersion} yet. Run "npx react-native-macos-init --overwrite" inside ${appName} once one does. (${error instanceof Error ? error.message : String(error)})`,
        );
      }
    }

    // Reconcile: a platform that failed to attach must not linger in the config or
    // leave behind a launcher script pointing at a directory that was never created.
    const failedPlatforms = platforms.filter((platform) => !attachedPlatforms.has(platform));
    if (failedPlatforms.length > 0) {
      appConfig.platforms = platforms.filter((platform) => attachedPlatforms.has(platform));
      await writeAppConfig(appRoot, appConfig);
      await removePackageJsonScripts(appRoot, failedPlatforms);
      // ...and the package that was installed for it, from package.json and the
      // lockfile both. Left in, react-native-windows shipped to every teammate of an
      // app with no windows/ folder at all; left in the lockfile alone, `npm ci`
      // refused to install the app.
      await takePlatformPackagesBackOut(appRoot, failedPlatforms, packageManager);

      // A missing folder explains nothing to whoever opens this repo on the machine
      // that CAN build it. Leave the decision, the reason and the one command that
      // finishes the job where they'll be looked for.
      // The RESOLVED React Native version, not the one that was asked for: the guide
      // explains that "latest" is useless months later, and printing "latest" as the
      // app's version in that same sentence contradicts it.
      const installedRn = await installedReactNativeVersion(appRoot, rnVersion);

      for (const platform of failedPlatforms) {
        if (platform !== 'windows' && platform !== 'macos') continue;
        await writeFiles([
          {
            path: `${platform}/README.md`,
            content: buildPlatformGuide({
              platform,
              appName,
              rnVersion: installedRn,
              packageManager,
              scaffoldedOn: process.platform,
            }),
          },
        ]);
      }
    }

    // Only for file: links. Installed from npm, the packages are ordinary
    // dependencies Metro already sees; watchFolders would instead name wherever this
    // CLI happens to be installed — under npx, a cache directory that gets cleaned —
    // and the React Native template's own metro.config.js is the right one to keep.
    if (linkedLocally) {
      await patchMetroConfigForLocalPackages(
        appRoot,
        [...localArmemonPackages, '@armemon-library/config-types'].map((packageName) =>
          resolveLocalPackageDir(packageName, fromCli),
        ),
      );
    }

    for (const plan of collectedPlans) {
      await writeFiles(plan.filesToWrite);

      if (plan.filesToCopy && plan.filesToCopy.length > 0) {
        const { missing } = await copyGeneratedFiles(appRoot, plan.filesToCopy);
        for (const source of missing) {
          logger.warn(`Couldn't copy "${source}" — it wasn't found in the app.`);
        }
      }
    }
    if (webScaffoldPlan && webScaffoldInputs) {
      // Plugin markup is merged into index.html before it is written: a web splash
      // has to be in the HTML itself to paint before the bundle parses, so it
      // cannot be a file any plugin writes on its own.
      // With the plugin's id, so its markup sits between markers `plugin remove` finds.
      const htmlContributions = collectedPlans.flatMap((plan, index) =>
        plan.htmlContributions ? [{ ...plan.htmlContributions, pluginId: collectedIds[index] }] : [],
      );

      const webContributions = collectedPlans
        .map((plan) => plan.webContributions)
        .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
      const webFiles = buildWebScaffoldPlan(
        webScaffoldInputs.react,
        webScaffoldInputs.dedupe,
        webContributions,
      ).filesToWrite.map((file) =>
        // Matched by suffix, not by an exact 'index.html': the web target moved
        // into web/ and an equality check silently stopped matching, so every
        // contribution — the whole web splash — was dropped without a word.
        file.path.endsWith('index.html') && htmlContributions.length > 0
          ? { ...file, content: applyHtmlContributions(file.content, htmlContributions) }
          : file,
      );
      await writeFiles(webFiles);
      await ignoreWebBuildOutput(appRoot);
    }

    // Keys a plugin needs in a JSON file the app already has — tsconfig.json's path
    // alias. After the web step, which edits tsconfig.json too, so the file comes out
    // the way `armemon plugin add` leaves it.
    for (const plan of collectedPlans) {
      for (const { path: relative, values } of plan.jsonMerges ?? []) {
        const file = path.join(appRoot, relative);
        const current = await fs.readFile(file, 'utf8').catch(() => null);
        if (current === null) {
          postInstallNotesFromMerges.push(`There is no ${relative} to merge into — if you add one, give it: ${JSON.stringify(values)}`);
          continue;
        }
        const merged = mergeJsonValues(current, values, relative);
        if (merged.changed) {
          await fs.writeFile(file, merged.content, 'utf8');
        } else if (!merged.already && merged.manual) {
          postInstallNotesFromMerges.push(`${merged.reason}. ${merged.manual}`);
        }
      }
    }

    const orderedPlugins: RuntimeCodegenPlugin[] = [];
    const runtimeContributions: RuntimeConfigContributions = {};
    for (const plan of collectedPlans) {
      if (plan.appEntryContributions) {
        orderedPlugins.push({
          packageName: plan.appEntryContributions.providerImport.from,
          runtimeExportName: plan.appEntryContributions.providerImport.importName,
        });
      }
      Object.assign(runtimeContributions, plan.runtimeConfigContributions ?? {});
    }
    await writeRuntimeConfig(appRoot, {
      orderedPlugins,
      contributions: runtimeContributions,
      language,
      layout: DEFAULT_LAYOUT,
    });

    const appRootChoice = pickAppRoot(hasNavigation);
    if (appRootChoice === 'welcome') {
      // Themed when the UI plugin is here, so a first run shows the theme working
      // rather than leaving it to be discovered in an example file.
      await writeFiles(
        buildScreenFiles({
          routeName: 'Welcome',
          shape: 'flat',
          language,
          kind: hasUiExample ? 'welcome-themed' : 'welcome',
          appName,
          layout: DEFAULT_LAYOUT,
        }),
      );
    }

    // ---- the layout the app author works in ---------------------------------
    //
    // A reference screen showing the folder shape a screen can grow into, and the
    // shared/ folders with a README each saying what belongs in them. Empty folders
    // cannot be committed, so the READMEs are both the placeholder and the guidance.
    //
    // Written in ONE batch: the JavaScript conversion only rewrites references it can
    // see in the same call.
    // Examples in the guidance take the app's own extension: a README is not source,
    // so the .ts-to-.js conversion never rewrites it.
    const sourceExtension = language === 'javascript' ? 'js' : 'ts';
    const skeleton: PluginInstallPlan['filesToWrite'] = [
      ...buildScreenFiles({
        routeName: 'Example',
        shape: 'full',
        language,
        kind: 'reference',
        layout: DEFAULT_LAYOUT,
      }),
      { path: `${SHARED_DIR}/README.md`, content: sharedReadme() },
      { path: `${SHARED_DIR}/components/README.md`, content: sharedFolderReadme('components', sourceExtension) },
      { path: `${SHARED_DIR}/hooks/README.md`, content: sharedFolderReadme('hooks', sourceExtension) },
      { path: `${SHARED_DIR}/utils/README.md`, content: sharedFolderReadme('utils', sourceExtension) },
    ];

    // Never overwrite something a plugin already wrote. A user whose initial route is
    // "Example" gets ExampleScreen's folder from the navigation plan, and the
    // reference screen would silently replace their real screen with a template.
    const alreadyWritten = new Set(writtenPaths);
    await writeFiles(skeleton.filter((file) => !alreadyWritten.has(file.path)));

    // The guide for the managed zone. Written last, so it describes a folder that
    // already exists, and written as a plain file armemon never reads back.
    await writeFiles([
      {
        path: `${managedPath(DEFAULT_LAYOUT, 'README.md')}`,
        content: `${managedReadme(DEFAULT_LAYOUT, { plugins: Object.keys(appConfig.plugins), language })}${options.commandReference ?? ''}`,
      },
    ]);

    if (writtenPaths.some((entry) => entry.startsWith(`${EXAMPLES_DIR}/`))) {
      await writeFiles([
        { path: `${EXAMPLES_DIR}/README.md`, content: examplesReadme(DEFAULT_LAYOUT) },
      ]);
    }

    await patchAppEntry({ appRoot, root: appRootChoice, language, layout: DEFAULT_LAYOUT });

    // The RN template's own test renders <App />, which now boots the whole provider
    // chain — without mocks for the native modules armemon just installed, a fresh
    // scaffold's first `npm test` fails.
    // Pinned: every package a linked @armemon-library/* module imports at runtime. Without
    // these, jest resolves them from the link target and the mocks never apply.
    const pinnedForJest = [
      ...selectedPlugins.flatMap((plugin) => plugin.manifest.peerPackages ?? []),
      ...JEST_MOCKABLE_PACKAGES,
    ].filter((name) => name in collected.dependencies);
    await writeJestSetup(
      appRoot,
      Object.keys(collected.dependencies),
      pinnedForJest,
      language,
      linkedLocally,
    );

    const postInstallNotes = [
      ...collectedPlans.flatMap((plan) => plan.postInstallNotes ?? []),
      ...postInstallNotesFromMerges,
    ];

    for (const plan of collectedPlans) {
      for (const step of plan.postInstallSteps ?? []) {
        stopIfInterrupted();
        try {
          // Plugin steps shell out to tools that print (the splash asset generator does).
          await withOutputStep(step.label, () =>
            step.run({ appRoot, appName, platforms: appConfig.platforms, packageManager }),
          );
        } catch (error) {
          logger.warn(`${step.label} failed. (${error instanceof Error ? error.message : String(error)})`);
          if (step.fallbackNote) postInstallNotes.push(step.fallbackNote);
        }
      }
    }

    stopIfInterrupted();
    await tryPodInstall(appRoot, appConfig.platforms);
    stopIfInterrupted();

    // Verification is ON by default. armemon knows what it wrote and which commands
    // it promised would work, so it runs them before claiming the app is ready.
    // Handing over a broken app under "Done — no manual wiring needed" is the one
    // failure a scaffolder cannot afford, and it happened twice before this existed:
    // a `web` script pointing at vite.config.ts in a JavaScript app, and an
    // index.html still naming the pre-conversion entry. Neither is visible to a type
    // checker; both are caught by running what the user is about to run.
    let verification: Awaited<ReturnType<typeof verifyGeneratedApp>> | null = null;
    if (!options.noVerify) {
      verification = await withSpinner('Checking the app works…', () =>
        verifyGeneratedApp({
          appRoot,
          isTypeScript: language === 'typescript',
          hasWeb: appConfig.platforms.includes('web'),
          packageManager,
          expectations: {
            files: [
              ...writtenPaths,
              ...collectedPlans.flatMap((plan) =>
                (plan.filesToCopy ?? []).map((entry) => entry.to),
              ),
            ],
            htmlSnippets: appConfig.platforms.includes('web')
              ? collectedPlans.flatMap((plan) => [
                  ...(plan.htmlContributions?.head ?? []),
                  ...(plan.htmlContributions?.bodyStart ?? []),
                ])
              : [],
            babelPlugins: collectedPlans.flatMap((plan) => plan.babelPlugins ?? []),
            entryPrelude: collectedPlans.flatMap((plan) => plan.entryPrelude ?? []),
            gitignoreEntries: [
              ...collectedPlans.flatMap((plan) => plan.gitignoreEntries ?? []),
              ...gitignoreEntriesForWeb,
            ],
          },
        }),
      );
    }

    if (options.json) {
      const ok = verification?.ok ?? true;
      writeJson({
        ok,
        appName,
        appRoot,
        rnVersion,
        packageManager,
        language,
        platforms: appConfig.platforms,
        plugins: selectedPlugins.map((plugin) => plugin.manifest.pluginId),
        failedPlatforms,
        dependencyConflicts: collected.conflicts,
        verification,
        postInstallNotes,
      });
      // The same exit code the prose path sets, so a script can rely on either.
      if (!ok) process.exitCode = 1;
      return;
    }

    if (verification && !verification.ok) {
      logger.error(`${appName} was created, but armemon's own checks found problems:`);
      for (const check of verification.checks.filter((entry) => !entry.ok)) {
        logger.error(`  ${check.name}: ${check.detail}`);
      }
      logger.info("This is an armemon bug, not something you did — please report it.");
      process.exitCode = 1;
    }

    logger.success(`Scaffolded ${appName} at ${appRoot}`);
    if (verification?.ok) {
      logger.success(`Checked ${verification.checks.map((c) => c.name).join(', ')} — all good.`);
    }
    logger.info(
      `Platforms: ${appConfig.platforms.join(', ')} — ${language}, package manager: ${packageManager}`,
    );
    if (selectedPlugins.length > 0) {
      logger.info(
        `Plugins: ${selectedPlugins.map((plugin) => plugin.manifest.displayName).join(', ')}`,
      );
    }
    if (linkedLocally) {
      // Only true when the CLI is running from its own checkout. Installed from
      // npm, the app gets ordinary version ranges and this doesn't apply.
      logger.warn(
        "This app links @armemon-library/* packages by absolute path, because this CLI is running from its own source checkout rather than an npm install. It only builds on this machine — don't commit package.json's file: paths expecting a teammate or CI to install them.",
      );
    }
    if (appConfig.platforms.includes('ios') || appConfig.platforms.includes('android')) {
      // npm needs the "run" keyword for custom scripts; pnpm/yarn/bun accept the
      // bare shortcut.
      const runPrefix = packageManager === 'npm' ? 'npm run' : packageManager;
      const script = appConfig.platforms.includes('ios') ? 'ios' : 'android';
      logger.info(`Next: cd ${appName} && ${runPrefix} ${script}`);
    }
    for (const note of postInstallNotes) {
      logger.warn(note);
    }

    clack.outro(
      verification && !verification.ok
        ? 'Finished with problems — see above.'
        : 'Done — no manual wiring needed.',
    );
  } catch (error) {
    // A cancel means "I don't want this after all", so a directory this run created
    // is removed rather than left to block a retry under the same name. A genuine
    // failure keeps it: there may be something worth salvaging, and silently
    // deleting a half-built app is worse than saying where it is.
    //
    // Ctrl-C counts as a cancel whatever the interrupted step threw — usually the
    // child process's own "killed by SIGINT" failure — and it can land while React
    // Native's CLI is still creating the folder, before createdAppDir is set.
    const cancelled = interrupted || error instanceof CancelledError;
    const folderExists = await fs.access(appRoot).then(() => true, () => false);
    if (!preExisting && (createdAppDir || (cancelled && folderExists))) {
      if (cancelled) {
        await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
        logger.info(`Removed the partially-created ${appName}.`);
      } else {
        logger.warn(
          `${appName} was partially created and has been left at ${appRoot}. Remove it before retrying with the same name.`,
        );
      }
    }
    throw cancelled && !(error instanceof CancelledError) ? new CancelledError() : error;
  } finally {
    process.off('SIGINT', onInterrupt);
  }
}
