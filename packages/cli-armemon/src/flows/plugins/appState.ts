/**
 * FILE: appState.ts
 * PATH: packages/cli-armemon/src/flows/plugins/appState.ts
 *
 * WHAT: Everything `armemon plugin add/remove/list` read about an app before deciding
 *       anything: its config, layout, package.json, how it gets @armemon-library
 *       packages, which plugins exist — and every installed plugin's plan, replayed.
 * WHY:  A plugin's files, dependencies and edits are whatever its plan() says for the
 *       answers it was given. Replaying the plans with the answers armemon.config
 *       recorded is what lets a command know, exactly, what a plugin put in the app
 *       without having written any of it down at the time — and what the app would
 *       look like with one plugin more or less.
 * HOW:  Built-in plugins resolve from the app first (the versions it runs), then from
 *       this CLI; a plugin being added comes from this CLI, so its code matches the
 *       version written into package.json. Plans replay in dependency order, each
 *       seeing the answers of the plugins before it, as they did at init.
 * WHEN: At the start of every plugin command.
 *
 * EXPORTS: AppState, ReplayedPlan, readAppState, discoverCatalog, loadWizard, replayPlans,
 *          pluginContext, CLI_DIR
 * DEPENDS ON: node:path, node:fs/promises, node:url, @armemon-library/cli-kit,
 *             @armemon-library/config-types, ../../constants, ../screenShared
 * USED BY: flows/plugins/*, flows/addPlatform.ts
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  CliError,
  discoverPlugins,
  discoverProjectPlugins,
  resolvePackageSubpathUrl,
  sortPluginsByDependencies,
  type DiscoveredPlugin,
} from '@armemon-library/cli-kit';
import type {
  AppLanguage,
  AppLayout,
  ArmemonAppConfig,
  PackageManager,
  Platform,
  PluginInstallPlan,
  PluginWizard,
  WizardContext,
} from '@armemon-library/config-types';
import { CATALOG_PACKAGES } from '../../constants.js';
import { openApp, type ScreenCommandOptions } from '../screenShared.js';

/** The CLI's own directory, which its built-in plugins resolve from in any install layout. */
export const CLI_DIR = path.dirname(fileURLToPath(import.meta.url));

export interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  overrides?: Record<string, string>;
  resolutions?: Record<string, string>;
  pnpm?: { overrides?: Record<string, string>; [key: string]: unknown };
  [key: string]: unknown;
}

export interface AppState {
  appRoot: string;
  cwd: string;
  config: ArmemonAppConfig;
  layout: AppLayout;
  language: AppLanguage;
  platforms: Platform[];
  packageManager: PackageManager;
  pkg: PackageJson;
  /** @armemon-library/core is a `file:` link, as it is in an app made from a source checkout. */
  linkedLocally: boolean;
  /** Every plugin that can be installed here: built-in, then the app's own. */
  catalog: DiscoveredPlugin[];
}

export interface ReplayedPlan {
  pluginId: string;
  plugin: DiscoveredPlugin;
  /** What armemon.config records — the answers the plan was replayed with. */
  answers: Record<string, unknown>;
  plan: PluginInstallPlan;
}

export async function readAppState(options: ScreenCommandOptions): Promise<AppState> {
  const { appRoot, config, layout } = await openApp(options);
  const pkgText = await fs.readFile(path.join(appRoot, 'package.json'), 'utf8').catch(() => null);
  if (pkgText === null) {
    throw new CliError(`No package.json in ${appRoot}.`, 'Run this from inside an app created by "armemon init", or pass --dir.');
  }
  let pkg: PackageJson;
  try {
    pkg = JSON.parse(pkgText) as PackageJson;
  } catch (error) {
    throw new CliError(
      `package.json in ${appRoot} isn't valid JSON, so nothing can be added or removed.`,
      `Fix it first. (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  return {
    appRoot,
    cwd: options.cwd,
    config,
    layout,
    language: config.language === 'javascript' ? 'javascript' : 'typescript',
    platforms: [...config.platforms],
    packageManager: config.packageManager,
    pkg,
    linkedLocally: (pkg.dependencies?.['@armemon-library/core'] ?? '').startsWith('file:'),
    catalog: await discoverCatalog(appRoot),
  };
}

/**
 * Built-in plugins, then any plugin the app itself depends on.
 *
 * A built-in resolves from the app first, so a plugin that is installed is replayed
 * with the code the app runs; one that isn't comes from this CLI.
 */
export async function discoverCatalog(appRoot: string): Promise<DiscoveredPlugin[]> {
  const builtIns: DiscoveredPlugin[] = [];
  for (const packageName of CATALOG_PACKAGES) {
    const [found] = await discoverPlugins([packageName], { resolveFrom: [appRoot, CLI_DIR] }).catch(() => []);
    if (found) builtIns.push(found);
  }
  const project = (await discoverProjectPlugins(appRoot).catch(() => [])).filter(
    (plugin) => !builtIns.some((builtIn) => builtIn.manifest.pluginId === plugin.manifest.pluginId),
  );
  return [...builtIns, ...project];
}

export async function loadWizard(plugin: DiscoveredPlugin, resolveFrom: string[]): Promise<PluginWizard> {
  let mod: { default?: PluginWizard };
  try {
    const url = resolvePackageSubpathUrl(plugin.packageName, 'wizard', { resolveFrom });
    mod = (await import(url)) as { default?: PluginWizard };
  } catch (error) {
    throw new CliError(
      `Couldn't load the wizard for "${plugin.packageName}".`,
      `Its "./wizard" export failed to import. (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  const wizard = mod.default;
  if (!wizard || typeof wizard.run !== 'function' || typeof wizard.plan !== 'function') {
    throw new CliError(
      `"${plugin.packageName}/wizard" doesn't default-export a valid PluginWizard.`,
      'It needs a default export with pluginId, intro, run() and plan().',
    );
  }
  return wizard;
}

/** The context a plugin's wizard runs in, for this app. */
export function pluginContext(
  state: AppState,
  answeredBefore: Record<string, unknown>,
  flags: Record<string, string | undefined> = {},
): WizardContext {
  return {
    appRoot: state.appRoot,
    cwd: state.cwd,
    appName: state.config.appName,
    rnVersion: state.config.rnVersion,
    packageManager: state.packageManager,
    platforms: state.platforms,
    language: state.language,
    flags,
    alreadyAnsweredByOtherPlugins: answeredBefore,
    layout: state.layout,
  };
}

/**
 * Every plugin's plan for these answers, in the order init runs them.
 *
 * `answers` maps plugin id to answers; a plugin not in the catalog can't be replayed
 * and is returned in `missing`. A plugin being added brings the plan its wizard just
 * made: its answers can name things — a logo outside the app — that armemon.config
 * records differently.
 */
export async function replayPlans(
  state: AppState,
  answers: Record<string, Record<string, unknown>>,
  options: {
    /** Where each plugin's wizard is loaded from. */
    resolveFor?: (plugin: DiscoveredPlugin) => string[];
    /** A plan already made from the answers just given, used instead of replaying one. */
    planned?: { pluginId: string; plan: PluginInstallPlan };
  } = {},
): Promise<{ plans: ReplayedPlan[]; missing: string[] }> {
  const resolveFor = options.resolveFor ?? (() => [state.appRoot, CLI_DIR]);
  const ids = Object.keys(answers);
  const found = ids.flatMap((id) => {
    const plugin = state.catalog.find((entry) => entry.manifest.pluginId === id);
    return plugin ? [plugin] : [];
  });
  const missing = ids.filter((id) => !found.some((plugin) => plugin.manifest.pluginId === id));

  const plans: ReplayedPlan[] = [];
  const answeredBefore: Record<string, unknown> = {};
  for (const plugin of sortPluginsByDependencies(found)) {
    const pluginId = plugin.manifest.pluginId;
    const recorded = answers[pluginId] ?? {};
    if (options.planned?.pluginId === pluginId) {
      plans.push({ pluginId, plugin, answers: recorded, plan: options.planned.plan });
      answeredBefore[pluginId] = recorded;
      continue;
    }
    const wizard = await loadWizard(plugin, resolveFor(plugin));
    let plan: PluginInstallPlan;
    try {
      plan = await wizard.plan(recorded as never, pluginContext(state, { ...answeredBefore }));
    } catch (error) {
      throw new CliError(
        `Couldn't work out what the ${pluginId} plugin adds to this app.`,
        `Its plan failed with the answers in armemon.config. (${error instanceof Error ? error.message : String(error)})`,
      );
    }
    plans.push({ pluginId, plugin, answers: recorded, plan });
    answeredBefore[pluginId] = recorded;
  }
  return { plans, missing };
}
