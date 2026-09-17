/**
 * FILE: compose.ts
 * PATH: packages/cli-armemon/src/flows/plugins/compose.ts
 *
 * WHAT: What an app's plugins add up to — every file exactly as init writes it, every
 *       package, Babel entry, entry line, script, gitignore line, piece of HTML and Vite
 *       config, runtime registration, and what the App entry opens on.
 * WHY:  `plugin add` and `plugin remove` are the same question asked twice: what does
 *       the app look like with these plugins, and with those? Answering it as data, for
 *       both sets, is what lets every change be worked out — and checked — before
 *       anything is written, and what keeps `init` and `plugin add` producing the same
 *       app: both read their output from the same plans the same way.
 * HOW:  Pure over replayed plans, apart from rendering: a JavaScript app's files go
 *       through the same conversion init uses, and managed files through the same
 *       formatting, so a composed file can be compared byte for byte with the disk.
 * WHEN: Twice per plugin command — for the plugins the app has, and for the ones it
 *       will have.
 *
 * EXPORTS: Composition, RenderedFile, compose, matchesGenerated, PROTECTED_PACKAGES, isFirstParty
 * DEPENDS ON: node:path, @armemon-library/cli-kit, @armemon-library/config-types, ./appState
 * USED BY: flows/plugins/reconcile.ts, flows/plugins/addPlugin.ts, flows/plugins/removePlugin.ts
 */

import path from 'node:path';
import {
  convertFilesToJavaScript,
  formatManagedSource,
  renderGeneratedFile,
  type AppRootChoice,
  type HtmlContribution,
  type RuntimeCodegenPlugin,
} from '@armemon-library/cli-kit';
import type { GeneratedFile, RuntimeConfigContributions, WebContributions } from '@armemon-library/config-types';
import type { AppState, ReplayedPlan } from './appState.js';

export interface RenderedFile extends GeneratedFile {
  /** Which plugin's plan writes it. */
  pluginId: string;
}

export interface Composition {
  plans: ReplayedPlan[];
  /** Plugin ids, in the order their plans run. */
  ids: string[];
  /** App-relative path → the file as it lands on disk. */
  files: Map<string, RenderedFile>;
  copies: Array<{ from: string; to: string; pluginId: string }>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  /** Package → the plugins that ask for it, the plugin packages themselves included. */
  requestedBy: Map<string, string[]>;
  /** Plugin id → its package. */
  pluginPackages: Map<string, string>;
  babelPlugins: string[];
  entryPrelude: string[];
  scripts: Record<string, string>;
  gitignore: string[];
  html: HtmlContribution[];
  web: WebContributions[];
  runtimePlugins: RuntimeCodegenPlugin[];
  runtimeContributions: RuntimeConfigContributions;
  /** What the App entry renders. */
  root: AppRootChoice;
  /** The welcome screen renders with the UI plugin's components. */
  themed: boolean;
  /** Every plugin's manifest peerPackages. */
  peerPackages: string[];
}

/** Packages no plugin command ever takes out of an app. */
export const PROTECTED_PACKAGES = new Set([
  'react',
  'react-native',
  'react-dom',
  'react-native-web',
  'vite',
  '@vitejs/plugin-react',
  'react-native-windows',
  'react-native-macos',
  '@armemon-library/core',
  '@armemon-library/config-types',
  '@types/jest',
]);

export const isFirstParty = (packageName: string) => packageName.startsWith('@armemon-library/');

const FORMATTABLE = /\.(ts|tsx|js|jsx)$/;

/**
 * Whether a file on disk is still what armemon generated. Line endings and formatting
 * don't count as a change: a file someone ran Prettier over holds nothing of theirs.
 */
export async function matchesGenerated(appRoot: string, current: string, generated: string, relative: string): Promise<boolean> {
  if (current === generated) return true;
  if (current.replace(/\r\n/g, '\n') === generated.replace(/\r\n/g, '\n')) return true;
  if (!FORMATTABLE.test(relative)) return false;
  const file = path.join(appRoot, ...relative.split('/'));
  return (await formatManagedSource(current, file)) === (await formatManagedSource(generated, file));
}

export async function compose(state: AppState, plans: ReplayedPlan[]): Promise<Composition> {
  const composition: Composition = {
    plans,
    ids: plans.map((entry) => entry.pluginId),
    files: new Map(),
    copies: [],
    dependencies: {},
    devDependencies: {},
    requestedBy: new Map(),
    pluginPackages: new Map(),
    babelPlugins: [],
    entryPrelude: [],
    scripts: {},
    gitignore: [],
    html: [],
    web: [],
    runtimePlugins: [],
    runtimeContributions: {},
    root: 'welcome',
    themed: false,
    peerPackages: [],
  };
  const request = (name: string, pluginId: string) =>
    composition.requestedBy.set(name, [...new Set([...(composition.requestedBy.get(name) ?? []), pluginId])]);

  for (const { pluginId, plugin, plan } of plans) {
    // Each plan converted in its own batch, as init writes each plan's files in one call.
    const files =
      state.language === 'javascript' ? (await convertFilesToJavaScript(plan.filesToWrite)).files : plan.filesToWrite;
    for (const file of files) {
      composition.files.set(file.path, {
        ...file,
        content: await renderGeneratedFile(state.appRoot, file, { layout: state.layout }),
        pluginId,
      });
    }
    for (const copy of plan.filesToCopy ?? []) composition.copies.push({ ...copy, pluginId });

    for (const [name, version] of Object.entries(plan.npmDependencies ?? {})) {
      composition.dependencies[name] = version;
      request(name, pluginId);
    }
    for (const [name, version] of Object.entries(plan.devDependencies ?? {})) {
      // @types packages only serve a type checker, so a JavaScript app never gets them.
      if (state.language === 'javascript' && name.startsWith('@types/')) continue;
      composition.devDependencies[name] = version;
      request(name, pluginId);
    }
    composition.pluginPackages.set(pluginId, plugin.packageName);
    request(plugin.packageName, pluginId);

    composition.babelPlugins.push(...(plan.babelPlugins ?? []));
    composition.entryPrelude.push(...(plan.entryPrelude ?? []));
    Object.assign(composition.scripts, plan.packageJsonScripts ?? {});
    composition.gitignore.push(...(plan.gitignoreEntries ?? []));
    if (plan.htmlContributions) composition.html.push({ ...plan.htmlContributions, pluginId });
    if (plan.webContributions) composition.web.push(plan.webContributions);
    if (plan.appEntryContributions) {
      composition.runtimePlugins.push({
        packageName: plan.appEntryContributions.providerImport.from,
        runtimeExportName: plan.appEntryContributions.providerImport.importName,
      });
    }
    Object.assign(composition.runtimeContributions, plan.runtimeConfigContributions ?? {});
    if (plan.provides?.includes('app-root')) composition.root = 'navigation';
    if (plan.provides?.includes('themed-components')) composition.themed = true;
    composition.peerPackages.push(...(plugin.manifest.peerPackages ?? []));
  }

  composition.babelPlugins = [...new Set(composition.babelPlugins)];
  composition.entryPrelude = [...new Set(composition.entryPrelude)];
  composition.gitignore = [...new Set(composition.gitignore)];
  composition.peerPackages = [...new Set(composition.peerPackages)];
  return composition;
}
