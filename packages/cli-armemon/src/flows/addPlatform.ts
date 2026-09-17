/**
 * FILE: addPlatform.ts
 * PATH: packages/cli-armemon/src/flows/addPlatform.ts
 *
 * WHAT: `armemon add <platform>` — adds a platform target to an app that already
 *       exists, doing every part of it.
 * WHY:  Platform choice was a decision you made once, at init, and could never
 *       revisit. The two ways out were both bad: scaffold a second app and merge it
 *       by hand, or run the raw React Native tools yourself and then remember the
 *       four things armemon would have done around them (install the right version
 *       of the platform package, add the launcher script, update armemon.config,
 *       re-apply what the web target needs from your plugins).
 *
 *       It also blocked the one workflow that genuinely can't be done in one place:
 *       windows/ can only be generated on Windows, because react-native-windows'
 *       CLI plugin looks for pwsh.exe and dotnet.exe merely to load. Someone has to
 *       add that target from a different machine, later, and that should be one
 *       command rather than a recipe.
 * HOW:  Reads armemon.config back, works out what is missing, and dispatches. Every
 *       version it needs is resolved from the registry against the app's OWN React
 *       Native version — never asked of the user, never hardcoded.
 * WHEN: On demand, from inside a scaffolded app.
 *
 * EXPORTS: runAddPlatformFlow, AddPlatformOptions
 * DEPENDS ON: node:path, node:fs/promises, node:os, @armemon-library/cli-kit, @armemon-library/config-types
 * USED BY: packages/cli-armemon/src/commands/add.ts
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import {
  logger,
  CliError,
  withSpinner,
  withOutputStep,
  writeAppConfig,
  mergeDependencies,
  installDependencies,
  addPackageJsonScripts,
  writeGeneratedFiles,
  copyGeneratedFiles,
  convertFilesToJavaScript,
  applyHtmlContributions,
  buildWebScaffoldPlan,
  ignoreWebBuildOutput,
  resolvePlatformPackageVersion,
  shellOutToReactNativeCli,
  shellOutToReactNativeWindowsCli,
  shellOutToReactNativeMacosCli,
  writeNpmrcForMacos,
  appendGitignoreEntries,
} from '@armemon-library/cli-kit';
import type { ArmemonAppConfig, PackageManager, Platform } from '@armemon-library/config-types';
import { ALL_PLATFORMS, BUILT_IN_PLUGIN_IDS, PLATFORM_PACKAGES, platformBuildableOnHost } from '../constants.js';
import { takePlatformPackagesBackOut } from './platformPackages.js';
import { readAppState, replayPlans, type ReplayedPlan } from './plugins/appState.js';
import { refreshPluginFiles } from './plugins/refresh.js';
import {
  applyOutputMode,
  emit,
  openApp,
  verifyApp,
  type ScreenCommandOptions,
} from './screenShared.js';

export interface AddPlatformOptions extends ScreenCommandOptions {
  platform: string;
}

/** The launcher script each platform gets, matching what init writes. */
const PLATFORM_SCRIPTS: Record<Platform, (language: string) => Record<string, string>> = {
  ios: () => ({ ios: 'react-native run-ios' }),
  android: () => ({ android: 'react-native run-android' }),
  macos: () => ({ macos: 'react-native run-macos' }),
  windows: () => ({ windows: 'react-native run-windows' }),
  web: (language) => {
    const config = `web/vite.config.${language === 'javascript' ? 'js' : 'ts'}`;
    return { web: `vite --config ${config}`, 'web:build': `vite build --config ${config}` };
  },
};

/** Where each platform's project lives, so "already added" is a fact and not a claim. */
const PLATFORM_DIRECTORY: Record<Platform, string> = {
  ios: 'ios',
  android: 'android',
  web: 'web',
  windows: 'windows',
  macos: 'macos',
};

async function exists(target: string): Promise<boolean> {
  return fs
    .access(target)
    .then(() => true)
    .catch(() => false);
}

/** The placeholder init leaves where it could not generate a platform. */
const PLACEHOLDER = 'README.md';

/**
 * Whether `directory` holds a real project rather than nothing, or the placeholder.
 *
 * "The folder exists" is not the question. init writes windows/README.md when it
 * can't generate the target on this host, so a plain existence check reported the
 * platform as already present and `armemon add windows` — the command that README
 * tells you to run — adopted an empty folder and generated nothing at all.
 */
async function hasProject(directory: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(directory);
    return entries.some((entry) => entry !== PLACEHOLDER);
  } catch {
    return false;
  }
}

async function readPackageJson(appRoot: string): Promise<{
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}> {
  return JSON.parse(await fs.readFile(path.join(appRoot, 'package.json'), 'utf8')) as never;
}

/**
 * The React Native version the app ACTUALLY has, not the one it was asked for.
 *
 * armemon.config records what you typed, which is often "latest" — useless for
 * pairing a platform package against months later, when "latest" means something
 * else entirely. package.json holds the resolved answer.
 */
async function installedReactNativeVersion(appRoot: string): Promise<string> {
  const pkg = await readPackageJson(appRoot);
  const declared = pkg.dependencies?.['react-native'];
  if (!declared) {
    throw new CliError(
      'No "react-native" dependency in package.json.',
      `Is ${appRoot} really a React Native app?`,
    );
  }
  return declared.replace(/^[\^~>=<\s]*/, '');
}

/** Adds the web target: the Vite project, its dependencies, and plugin contributions. */
async function addWeb(appRoot: string, config: ArmemonAppConfig, cwd: string): Promise<string[]> {
  const pkg = await readPackageJson(appRoot);
  // Every plugin's plan again, from the answers armemon.config recorded: the splash
  // plugin contributes the markup web/index.html paints on the first frame, and copies
  // the logo into web/public. The platform being added has to be in the list — a
  // plugin decides what to contribute from it.
  const state = await readAppState({ cwd, dir: appRoot });
  state.platforms = [...new Set([...state.platforms, 'web' as Platform])];
  let replayed: ReplayedPlan[] = [];
  try {
    const result = await replayPlans(state, config.plugins ?? {});
    replayed = result.plans;
    for (const id of result.missing) {
      logger.warn(`Plugin "${id}" is in armemon.config but isn't installed here, so anything it contributes to this platform is skipped.`);
    }
  } catch (error) {
    logger.warn(`Couldn't replay the plugins' setup for this platform: ${error instanceof Error ? error.message : String(error)}`);
  }
  const plans = replayed.map((entry) => entry.plan);

  const dedupe = [
    'react',
    'react-dom',
    'react-native',
    'react-native-web',
    ...Object.keys(pkg.dependencies ?? {}).filter(
      (name) => !name.startsWith('@armemon-library/') && !name.startsWith('@types/'),
    ),
  ];

  const plan = buildWebScaffoldPlan(
    pkg.dependencies?.react ?? 'latest',
    [...new Set(dedupe)],
    plans
      .map((entry) => entry.webContributions)
      .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined),
  );

  let files = plan.filesToWrite;
  if (config.language === 'javascript') {
    files = (await convertFilesToJavaScript(files)).files;
  }

  // The same composition init does: plugin markup goes into index.html before it is
  // written, so this doesn't fight the scaffold over the same file.
  const htmlContributions = replayed.flatMap((entry) =>
    entry.plan.htmlContributions ? [{ ...entry.plan.htmlContributions, pluginId: entry.pluginId }] : [],
  );

  if (htmlContributions.length > 0) {
    files = files.map((file) =>
      file.path.endsWith('index.html')
        ? { ...file, content: applyHtmlContributions(file.content, htmlContributions) }
        : file,
    );
  }

  await writeGeneratedFiles(appRoot, files);

  // Assets the web target needs — the splash logo lands in web/public.
  const toCopy = plans
    .flatMap((entry) => entry.filesToCopy ?? [])
    .filter((file) => file.to.startsWith('web/'));
  if (toCopy.length > 0) await copyGeneratedFiles(appRoot, toCopy);

  // Build output, not source — the same line init writes. Without it the first
  // `npm run web:build` left web/dist/ waiting to be committed.
  await appendGitignoreEntries(appRoot, ['web/dist/']);
  // …and out of tsc and ESLint, which otherwise read the built bundle as source.
  await ignoreWebBuildOutput(appRoot);

  await mergeDependencies(appRoot, plan.npmDependencies);
  // Merging the dependency is not having it: without this, package.json named vite
  // and `npm run web` answered "vite: not found".
  await withOutputStep('Installing…', () =>
    installDependencies(appRoot, config.packageManager as PackageManager, { retries: 1 }),
  );

  return [
    'web/ is a real Vite project: its own index.html, entry and public/ folder.',
    ...(htmlContributions.length > 0 ? ['Splash markup and assets re-applied from your plugins.'] : []),
  ];
}

/** Adds a native target whose own CLI generates the project (windows, macos). */
async function addNativeTarget(
  appRoot: string,
  platform: 'windows' | 'macos',
  packageManager: PackageManager,
): Promise<string[]> {
  const packageName = PLATFORM_PACKAGES[platform]?.[0];
  if (!packageName) throw new CliError(`No package known for the ${platform} target.`, '');

  const rnVersion = await installedReactNativeVersion(appRoot);
  const notes: string[] = [];

  const resolved = await withSpinner(`Finding the ${packageName} release for React Native ${rnVersion}…`, () =>
    resolvePlatformPackageVersion(packageName, rnVersion),
  );

  if (!resolved) {
    throw new CliError(
      `No ${packageName} release exists that pairs with React Native ${rnVersion}.`,
      'This usually means React Native is newer than the platform has shipped for. Try again after its next release.',
    );
  }

  if (resolved.behind) {
    notes.push(
      `${packageName} ${resolved.version} is the newest release, and it targets an older React Native than your ${rnVersion}. The build normally still works; expect a peer-dependency warning.`,
    );
  }

  try {
    // macOS: react-native-macos-init installs the package itself, and pins an exact
    // peer React Native patch that essentially never matches — hence the .npmrc.
    if (platform === 'macos') {
      await writeNpmrcForMacos(appRoot);
    } else {
      await mergeDependencies(appRoot, { [packageName]: resolved.range });
      await withOutputStep('Installing…', () => installDependencies(appRoot, packageManager, { retries: 1 }));
    }

    await withOutputStep(`Generating ${platform}/…`, () =>
      platform === 'windows'
        ? shellOutToReactNativeWindowsCli({ appRoot })
        : shellOutToReactNativeMacosCli({ appRoot }),
    );
  } catch (error) {
    // The package went in and something after it failed. init reconciles this; add
    // used to stop here, leaving a dependency nothing uses in package.json and the
    // lockfile. Nothing else has been recorded yet — no script, no config entry — so
    // taking the package out returns the app to how it was.
    await takePlatformPackagesBackOut(appRoot, [platform], packageManager);
    throw new CliError(
      `Adding ${platform} failed, so ${packageName} was taken back out and nothing else changed. (${error instanceof Error ? error.message.split('\n')[0] : String(error)})`,
      platform === 'windows'
        ? 'Windows targets need Windows with Visual Studio and the Windows SDK. Run the command again once those are installed.'
        : `react-native-macos may not have a release that works with this app's React Native yet. Run the command again once one does.`,
    );
  }

  return notes;
}

/**
 * Adds ios/ or android/, which come from React Native's own template.
 *
 * These have no attach tool: the folder is created once, by `react-native init`, and
 * deleting it is normally permanent. Rather than tell you that, armemon scaffolds a
 * throwaway app at YOUR app's exact React Native version and lifts the folder out of
 * it — the same files you would have had, generated by the same template.
 */
async function addTemplatePlatform(
  appRoot: string,
  platform: 'ios' | 'android',
  appName: string,
): Promise<string[]> {
  const rnVersion = await installedReactNativeVersion(appRoot);
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'armemon-platform-'));

  try {
    await withOutputStep(`Generating ${platform}/ from the React Native ${rnVersion} template…`, () =>
      shellOutToReactNativeCli({ appName, version: rnVersion, cwd: scratch }),
    );

    const source = path.join(scratch, appName, platform);
    if (!(await exists(source))) {
      throw new CliError(
        `React Native ${rnVersion}'s template produced no ${platform}/ folder.`,
        'Nothing was changed in your app.',
      );
    }

    await fs.cp(source, path.join(appRoot, platform), { recursive: true });
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }

  return [
    `${platform}/ came from React Native ${rnVersion}'s template, matching the version your app actually runs.`,
    platform === 'ios'
      ? 'Native module setup for your installed packages happens on the next `pod install` (run it on a Mac).'
      : 'Any native module that needs Gradle changes will pick them up on the next build.',
  ];
}

/** What `add` would do, in order — the --dry-run answer. */
function plannedSteps(platform: Platform, onDisk: boolean, language: string): string[] {
  const directory = PLATFORM_DIRECTORY[platform];
  const packageName = PLATFORM_PACKAGES[platform]?.[0];
  const steps: string[] = [];

  if (onDisk) {
    steps.push(`Adopt the existing ${directory}/ as it is — nothing in it is regenerated.`);
  } else if (platform === 'web') {
    steps.push(
      'Generate web/ as a Vite project — index.html, the entry and public/ — with what your plugins contribute to it.',
      'Add web/dist/ to .gitignore.',
      'Install Vite, react-dom and react-native-web.',
    );
  } else if (platform === 'windows' || platform === 'macos') {
    steps.push(`Ask the npm registry which ${packageName} release pairs with this app's React Native.`);
    steps.push(
      platform === 'windows'
        ? `Install ${packageName}, then run "react-native init-windows" to generate windows/.`
        : `Run "react-native-macos-init", which installs ${packageName} and generates macos/.`,
    );
    steps.push(`If generating fails, take ${packageName} back out so the app is left as it was.`);
  } else {
    steps.push(`Generate ${directory}/ from the React Native template at this app's own version.`);
  }

  const scripts = Object.keys(PLATFORM_SCRIPTS[platform](language));
  steps.push(
    "Bring your plugins' files in line with the new platform — write what a plugin only needs there (the splash screen's hide.web), and update any file a plugin writes differently for it while it is still exactly as armemon wrote it.",
  );
  steps.push(
    `Add the ${scripts.map((name) => `"${name}"`).join(' and ')} script${scripts.length === 1 ? '' : 's'} to package.json.`,
    `Add "${platform}" to the platforms in armemon.config.`,
  );
  return steps;
}

export async function runAddPlatformFlow(options: AddPlatformOptions): Promise<void> {
  applyOutputMode(options);

  const platform = options.platform as Platform;
  if (!ALL_PLATFORMS.includes(platform)) {
    throw new CliError(
      `Unknown platform "${options.platform}".`,
      `Valid platforms are: ${ALL_PLATFORMS.join(', ')}. To add a plugin instead, use "armemon plugin add ${
        (BUILT_IN_PLUGIN_IDS as readonly string[]).includes(options.platform) ? options.platform : '<id>'
      }".`,
    );
  }

  // Like every other command: --dir exactly, or the nearest app at or above here.
  const { appRoot, config } = await openApp(options);

  const recorded = (config.platforms as Platform[]) ?? [];
  const directory = path.join(appRoot, PLATFORM_DIRECTORY[platform]);
  const onDisk = await hasProject(directory);

  if (recorded.includes(platform) && onDisk) {
    logger.info(`${platform} is already set up in this app — nothing to do.`);
    // A script reading --json gets an answer on this path too, not an empty stdout.
    emit({ ok: true, added: null, alreadyPresent: true, platform, platforms: recorded }, options);
    return;
  }

  if (options.dryRun) {
    const steps = plannedSteps(platform, onDisk, config.language);
    if (!options.json) {
      logger.info(`Adding ${platform} would:`);
      for (const step of steps) logger.info(`  - ${step}`);
      logger.info('Nothing was changed (--dry-run).');
    }
    emit({ ok: true, dryRun: true, platform, steps }, options);
    return;
  }

  if (onDisk && !recorded.includes(platform)) {
    // A real project the config doesn't know about: someone ran the platform's own
    // tool by hand. Adopt it rather than overwrite it.
    logger.info(`Found an existing ${PLATFORM_DIRECTORY[platform]}/ — adopting it into armemon.config.`);
  }

  if (!platformBuildableOnHost(platform)) {
    logger.warn(
      `${platform} can't be BUILT on ${process.platform}. Adding the target here is still useful — it gets committed and built on a machine that can.`,
    );
  }

  const notes: string[] = [];

  if (!onDisk) {
    if (platform === 'web') {
      notes.push(...(await addWeb(appRoot, config, options.cwd)));
    } else if (platform === 'windows' || platform === 'macos') {
      notes.push(...(await addNativeTarget(appRoot, platform, config.packageManager as PackageManager)));
    } else {
      notes.push(...(await addTemplatePlatform(appRoot, platform, config.appName)));
    }
  }

  // The placeholder said "not generated yet". It is now, so it would be a lie —
  // and the next reader would follow instructions they have already carried out.
  const placeholder = path.join(directory, PLACEHOLDER);
  if (!onDisk && platform !== 'web' && (await exists(placeholder))) {
    await fs.rm(placeholder, { force: true });
  }

  await addPackageJsonScripts(appRoot, PLATFORM_SCRIPTS[platform](config.language));

  config.platforms = [...ALL_PLATFORMS.filter((entry) => recorded.includes(entry) || entry === platform)];
  await writeAppConfig(appRoot, config);

  // What the plugins write depends on the platforms — the same plugins, planned for this
  // app with the new target, is what `init` would have written.
  try {
    const refreshed = await refreshPluginFiles(appRoot, options.cwd, { before: recorded, after: config.platforms as Platform[] });
    if (refreshed.created.length > 0) notes.push(`Wrote what your plugins need for ${platform}: ${refreshed.created.join(', ')}.`);
    if (refreshed.updated.length > 0) notes.push(`Updated for ${platform}: ${refreshed.updated.join(', ')}.`);
    if (refreshed.kept.length > 0) {
      notes.push(
        `These plugin files would be written differently for ${platform}, but have your changes, so they were left as they are: ${refreshed.kept.join(', ')}.`,
      );
    }
  } catch (error) {
    logger.warn(
      `Couldn't bring the plugins' files in line with ${platform}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // The same check init runs, for the same reason: adding a target is exactly the
  // kind of change that can leave a script pointing at something that isn't there,
  // and finding that out from a failed build later is the outcome this exists to
  // prevent. --no-verify skips it, as on every other command.
  const verification = await verifyApp(appRoot, config, options);

  if (!options.json) {
    if (verification && !verification.ok) {
      logger.warn(`Added ${platform}, but armemon's own checks found problems:`);
      for (const check of verification.checks.filter((entry) => !entry.ok)) {
        logger.warn(`  ${check.name}: ${check.detail}`);
      }
    }

    logger.success(`Added ${platform}.`);
    if (verification?.ok) {
      logger.success(`Checked ${verification.checks.map((check) => check.name).join(', ')} — all good.`);
    }
    logger.info(`Platforms: ${config.platforms.join(', ')}`);
    for (const note of notes) logger.info(note);
    logger.info(
      `Commit ${PLATFORM_DIRECTORY[platform]}/ — it's a normal part of the repo now, and nobody has to repeat this.`,
    );
  }

  emit(
    {
      ok: verification?.ok ?? true,
      added: platform,
      platforms: config.platforms,
      notes,
      verification: verification ? { ok: verification.ok, checks: verification.checks } : null,
    },
    options,
  );
}
