/**
 * FILE: reconcile.ts
 * PATH: packages/cli-armemon/src/flows/plugins/reconcile.ts
 *
 * WHAT: Works out every change that takes an app from one set of plugins to another —
 *       files to create, edit and delete, packages to add and remove — and everything
 *       that stands in the way, without writing a byte.
 * WHY:  This is where the rulebook in docs/plugins.md is enforced. A plugin reaches
 *       into a dozen files armemon shares with the app's author; changing those one by
 *       one and stopping at the first problem leaves an app half-changed. Deciding
 *       everything first is what makes "all or nothing" possible, and what makes
 *       `--dry-run` show exactly what a real run does.
 * HOW:  One pass per channel a plan can contribute to. A shared file that is still
 *       exactly what armemon would generate for the current plugins is generated again
 *       for the new ones — the same bytes `init` writes. One that has been edited is
 *       changed in place through a parser-backed patcher, which keeps everything else.
 *       What neither can do safely becomes a blocker with the fix spelled out. Every
 *       edit is staged in a ChangeSet; the transaction commits it.
 * WHEN: Once per `armemon plugin add` / `plugin remove`, after both compositions exist.
 *
 * EXPORTS: reconcile, Reconciliation, Blocker, Kept, DependencyDelta, JestChange
 * DEPENDS ON: node:path, node:fs/promises, @armemon-library/cli-kit,
 *             @armemon-library/config-types, ../screenShared, ./appState, ./compose
 * USED BY: flows/plugins/addPlugin.ts, flows/plugins/removePlugin.ts
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import {
  JEST_MOCKABLE_PACKAGES,
  addBabelPlugins,
  addEntryPrelude,
  addHtmlContributions,
  appEntryFileName,
  appSourceFiles,
  applyHtmlContributions,
  buildAppEntrySource,
  buildArmemonDependencySpecifier,
  buildBabelConfigSource,
  buildJestResolverSource,
  buildJestSetupSource,
  buildMetroConfigSource,
  buildScreenFiles,
  buildWebScaffoldPlan,
  convertFilesToJavaScript,
  findAppConfigFile,
  generateRuntimeConfigSource,
  gitignoreWithEntries,
  jestResolverPins,
  managedReadme,
  mergeJsonValues,
  moduleReferences,
  officialMockProbe,
  packageNameOf,
  patchJestResolverPins,
  patchJestSetup,
  patchMetroWatchFolders,
  patchRuntimeGenerated,
  patchViteConfig,
  readPathAliases,
  readViteDedupe,
  removeBabelPlugins,
  removeEntryPrelude,
  removeHtmlContributions,
  renderGeneratedFile,
  resolveLocalPackageDir,
  resolvePluginSpecifier,
  resolveRelativeModule,
  sameCode,
  serializeAppConfig,
  subtractJsonValues,
  swapAppEntryRoot,
  unmergeJsonValues,
  type AppliedExpectations,
  type DiscoveredPlugin,
  type PatchResult,
} from '@armemon-library/cli-kit';
import {
  EXAMPLES_DIR,
  SCREENS_DIR,
  isManaged,
  managedFile,
  managedPath,
  type ArmemonAppConfig,
  type PluginInstallPlan,
} from '@armemon-library/config-types';
import { ChangeSet } from '../screenShared.js';
import { examplesReadme } from '../initReactNative.js';
import { CLI_DIR, type AppState, type PackageJson } from './appState.js';
import { PROTECTED_PACKAGES, isFirstParty, matchesGenerated, type Composition, type RenderedFile } from './compose.js';

export interface Blocker {
  /** Which rule stopped it: R2 your edits are never lost, R4 don't break the app, or a file armemon can't edit safely. */
  rule: 'R2' | 'R4' | 'edit';
  file?: string;
  reason: string;
  /** What to do about it. */
  manual?: string;
}

export interface Kept {
  file: string;
  reason: string;
}

export interface DependencyDelta {
  add: Record<string, string>;
  addDev: Record<string, string>;
  remove: string[];
  /** Packages the change would have taken out, and why they stay. */
  kept: Array<{ name: string; reason: string }>;
  /** Packages the plugin asks for at a version other than the one installed, which stays. */
  conflicts: Array<{ name: string; installed: string; wanted: string }>;
}

/** jest.setup.js is written after the install, when the packages' own mocks can be found. */
export interface JestChange {
  /** The file is still what armemon generated: write it again for these packages. */
  regenerate: string[] | null;
  add: string[];
  remove: string[];
}

export interface Reconciliation {
  changes: ChangeSet;
  /** App-relative paths this change creates. */
  created: string[];
  /** App-relative paths this change deletes. */
  deletions: string[];
  /** Files copied in, `from` absolute and `to` app-relative. */
  copies: Array<{ from: string; to: string }>;
  blockers: Blocker[];
  kept: Kept[];
  notes: string[];
  dependencies: DependencyDelta;
  jest: JestChange | null;
  expectations: AppliedExpectations;
}

export interface ReconcileInput {
  state: AppState;
  before: Composition;
  after: Composition;
  target: { pluginId: string; plugin: DiscoveredPlugin; plan: PluginInstallPlan; action: 'add' | 'remove' };
  /** The command reference the managed guide ends with, generated from the live program. */
  commandReference?: string;
}

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((entry) => b.some((other) => sameCode(entry, other)));

export async function reconcile(input: ReconcileInput): Promise<Reconciliation> {
  const { state, before, after, target } = input;
  const { appRoot, layout, language } = state;
  const adding = target.action === 'add';
  const changes = new ChangeSet(appRoot);

  const result: Reconciliation = {
    changes,
    created: [],
    deletions: [],
    copies: [],
    blockers: [],
    kept: [],
    notes: [],
    dependencies: { add: {}, addDev: {}, remove: [], kept: [], conflicts: [] },
    jest: null,
    expectations: {},
  };

  const abs = (relative: string) => path.join(appRoot, ...relative.split('/'));
  const read = (relative: string) => changes.read(abs(relative));
  const stage = async (relative: string, content: string) => {
    if ((await read(relative)) === null && !result.created.includes(relative)) result.created.push(relative);
    await changes.stage(abs(relative), content);
  };
  const block = (blocker: Blocker) => result.blockers.push(blocker);
  const applyPatch = async (relative: string, patch: PatchResult) => {
    if (patch.changed) await stage(relative, patch.content);
    else if (!patch.already) {
      block({
        rule: patch.conflict ? 'R2' : 'edit',
        file: relative,
        reason: patch.reason ?? "armemon couldn't edit it safely",
        manual: patch.manual,
      });
    }
  };

  const sameAsGenerated = (current: string, generated: string, relative: string) =>
    matchesGenerated(appRoot, current, generated, relative);

  const isPluginZone = (relative: string) => isManaged(layout, relative) || relative.startsWith('src/');

  // ---- files the plugin writes ------------------------------------------------------
  const otherPluginsChanged = new Set<string>();
  const paths = new Set([...before.files.keys(), ...after.files.keys()]);
  for (const relative of paths) {
    const was = before.files.get(relative);
    const will = after.files.get(relative);
    const targets = (file: RenderedFile | undefined) => file?.pluginId === target.pluginId;

    if (!targets(was) && !targets(will)) {
      // Another plugin's output depends on this one — navigation's sample sign-in flow
      // reads Redux's answers. Its files are the app's now; they are left as they are.
      if (was?.content !== will?.content) otherPluginsChanged.add((will ?? was)!.pluginId);
      continue;
    }

    const current = await read(relative);
    if (adding && will && targets(will)) {
      result.expectations.files = [...(result.expectations.files ?? []), relative];
      if (current === null) {
        await stage(relative, will.content);
      } else if (await sameAsGenerated(current, will.content, relative)) {
        // Already exactly this.
      } else if (will.whenPresent === 'keep') {
        result.kept.push({ file: relative, reason: 'already there, and it is the app’s own — left as it is' });
      } else if (will.whenPresent === 'replace') {
        await stage(relative, will.content);
      } else {
        block({
          rule: 'R2',
          file: relative,
          reason: `already exists, and isn't what the ${target.pluginId} plugin writes there`,
          manual: 'Move or rename it and run the command again, or pass --force to keep yours as it is.',
        });
      }
      continue;
    }

    if (!adding && was && targets(was) && !will) {
      if (current === null) continue;
      if (was.whenPresent === 'keep') {
        result.kept.push({ file: relative, reason: 'the app’s own once written — plugin remove never deletes it' });
      } else if (!isPluginZone(relative)) {
        result.kept.push({ file: relative, reason: 'a project file — plugin remove never deletes those' });
      } else if (await sameAsGenerated(current, was.content, relative)) {
        result.deletions.push(relative);
      } else {
        block({
          rule: 'R2',
          file: relative,
          reason: `isn't what the ${target.pluginId} plugin writes there — it was changed (by hand, or by a command like armemon set, create-screen or create-slice), or written by an earlier version of the plugin`,
          manual: "Delete it yourself if you don't need what changed, or pass --force to keep it as it is.",
        });
      }
    }
  }
  for (const pluginId of otherPluginsChanged) {
    result.notes.push(
      `The ${pluginId} plugin would generate some files differently with this change. Its files are yours now, so they were left as they are.`,
    );
  }

  // ---- copied assets ----------------------------------------------------------------
  const targetCopies = (adding ? after : before).copies.filter((copy) => copy.pluginId === target.pluginId);
  for (const copy of targetCopies) {
    const destination = abs(copy.to);
    const exists = await fs.stat(destination).then(() => true, () => false);
    if (!adding) {
      if (exists) result.kept.push({ file: copy.to, reason: 'an asset the plugin copied in — plugin remove never deletes assets' });
      continue;
    }
    const from = path.resolve(appRoot, copy.from);
    const source = await fs.readFile(from).catch(() => null);
    if (source === null) {
      result.notes.push(`Couldn't copy ${copy.from} to ${copy.to} — it wasn't found.`);
    } else if (!exists) {
      result.copies.push({ from, to: copy.to });
      result.created.push(copy.to);
    } else if (!(await fs.readFile(destination)).equals(source)) {
      result.kept.push({ file: copy.to, reason: 'already exists — left as it is' });
    }
  }

  // ---- package.json scripts -------------------------------------------------------------
  const scripts = { ...(state.pkg.scripts ?? {}) };
  let scriptsChanged = false;
  for (const [name, command] of Object.entries(target.plan.packageJsonScripts ?? {})) {
    if (adding) {
      if (scripts[name] === undefined) {
        scripts[name] = command;
        scriptsChanged = true;
      } else if (scripts[name] !== command) {
        block({
          rule: 'R2',
          file: 'package.json',
          reason: `its "${name}" script is already "${scripts[name]}"`,
          manual: `Rename that script, or pass --force to keep it — the plugin wants "${name}": "${command}".`,
        });
      }
    } else if (after.scripts[name] === undefined && scripts[name] !== undefined) {
      if (scripts[name] === command) {
        delete scripts[name];
        scriptsChanged = true;
      } else {
        result.kept.push({ file: 'package.json', reason: `the "${name}" script was changed, so it stays` });
      }
    }
  }

  // ---- keys merged into JSON files the app has (tsconfig.json) --------------------------
  for (const { path: relative, values } of target.plan.jsonMerges ?? []) {
    const current = await read(relative);
    if (current === null) {
      // Not created from nothing: a tsconfig.json holding only a path alias would drop
      // everything the app's type-checking relies on.
      if (adding) {
        result.notes.push(`The app has no ${relative}, so nothing was merged into it. If it gets one, add: ${JSON.stringify(values)}`);
      }
      continue;
    }
    if (adding) {
      await applyPatch(relative, mergeJsonValues(current, values, relative));
      continue;
    }
    // Only what no plugin that stays merges too.
    const others = after.plans.flatMap((entry) =>
      (entry.plan.jsonMerges ?? []).filter((merge) => merge.path === relative).map((merge) => merge.values),
    );
    const own = subtractJsonValues(values, others);
    if (Object.keys(own).length > 0) await applyPatch(relative, unmergeJsonValues(current, own, relative));
  }

  // ---- .gitignore — only ever added to ------------------------------------------------
  if (adding && (target.plan.gitignoreEntries ?? []).length > 0) {
    const current = (await read('.gitignore')) ?? '';
    const next = gitignoreWithEntries(current, target.plan.gitignoreEntries ?? []);
    if (next !== current) await stage('.gitignore', next);
    result.expectations.gitignoreEntries = target.plan.gitignoreEntries;
  }

  // ---- babel.config.js ------------------------------------------------------------------
  if (!sameList(before.babelPlugins, after.babelPlugins)) {
    const current = await read('babel.config.js');
    const added = after.babelPlugins.filter((entry) => !before.babelPlugins.some((other) => sameCode(entry, other)));
    const removed = before.babelPlugins.filter((entry) => !after.babelPlugins.some((other) => sameCode(entry, other)));
    if (current === null) {
      block({
        rule: 'edit',
        file: 'babel.config.js',
        reason: "the app has no babel.config.js",
        manual: `Create one with React Native's preset${added.length > 0 ? ` and these plugins: ${added.join(', ')}` : ''}.`,
      });
    } else if (current === buildBabelConfigSource(current, before.babelPlugins)) {
      await stage('babel.config.js', buildBabelConfigSource(current, after.babelPlugins));
    } else {
      let patched: PatchResult = { content: current, changed: false, already: true };
      if (removed.length > 0) patched = removeBabelPlugins(current, removed);
      if (added.length > 0 && (patched.changed || patched.already)) {
        const next = addBabelPlugins(patched.content, added);
        // A refusal has to surface even after a removal that worked.
        if (!next.already) patched = next.changed ? next : { ...next, content: current };
      }
      await applyPatch('babel.config.js', patched);
    }
    if (adding) result.expectations.babelPlugins = added;
  }

  // ---- index.js -------------------------------------------------------------------------
  const preludeAdded = after.entryPrelude.filter((line) => !before.entryPrelude.includes(line));
  const preludeRemoved = before.entryPrelude.filter((line) => !after.entryPrelude.includes(line));
  if (preludeAdded.length > 0 || preludeRemoved.length > 0) {
    const current = await read('index.js');
    if (current === null) {
      if (preludeAdded.length > 0) {
        block({ rule: 'edit', file: 'index.js', reason: 'the app has no index.js', manual: `Put these first in your entry file:\n${preludeAdded.join('\n')}` });
      }
    } else {
      let patched: PatchResult =
        preludeRemoved.length > 0 ? removeEntryPrelude(current, preludeRemoved) : { content: current, changed: false, already: true };
      if (preludeAdded.length > 0 && (patched.changed || patched.already)) {
        const next = addEntryPrelude(patched.content, preludeAdded, before.entryPrelude);
        if (!next.already) patched = next.changed ? next : { ...next, content: current };
      }
      await applyPatch('index.js', patched);
    }
    if (adding) result.expectations.entryPrelude = preludeAdded;
  }

  // ---- runtime.generated ----------------------------------------------------------------
  {
    const relative = managedFile.runtimeGenerated(layout, language);
    const render = (composition: Composition) =>
      generateRuntimeConfigSource({
        orderedPlugins: composition.runtimePlugins,
        contributions: composition.runtimeContributions,
        language,
        layout,
      });
    const was = render(before);
    const will = render(after);
    if (was !== will) {
      const current = await read(relative);
      if (current === null) {
        await stage(relative, will);
      } else if (await sameAsGenerated(current, was, relative)) {
        await stage(relative, will);
      } else {
        const own = target.plan.appEntryContributions?.providerImport;
        const order = after.runtimePlugins.map((entry) => entry.packageName);
        const next = own ? order.slice(order.indexOf(own.from) + 1).find((from) => before.runtimePlugins.some((entry) => entry.packageName === from)) : undefined;
        await applyPatch(
          relative,
          patchRuntimeGenerated(
            current,
            {
              ...(own && adding ? { addPlugins: [{ importName: own.importName, from: own.from, ...(next ? { before: next } : {}) }] } : {}),
              ...(own && !adding ? { removePlugins: [own.from] } : {}),
              contributions: { before: before.runtimeContributions, after: after.runtimeContributions },
            },
            path.basename(relative),
          ),
        );
      }
    }
  }

  // ---- what the app opens on ------------------------------------------------------------
  const welcomeFiles = async (themed: boolean) => {
    const files = buildScreenFiles({
      routeName: 'Welcome',
      shape: 'flat',
      language,
      kind: themed ? 'welcome-themed' : 'welcome',
      appName: state.config.appName,
      layout,
    });
    const converted = language === 'javascript' ? (await convertFilesToJavaScript(files)).files : files;
    return Promise.all(
      converted.map(async (file) => ({ ...file, content: await renderGeneratedFile(appRoot, file, { layout }) })),
    );
  };

  if (before.root !== after.root) {
    const relative = appEntryFileName(language);
    const current = await read(relative);
    if (current === null) {
      block({ rule: 'edit', file: relative, reason: `the app has no ${relative}`, manual: `Render <${after.root === 'navigation' ? 'RootNavigator' : 'WelcomeScreen'} /> inside <KitProvider> in your App entry.` });
    } else if (current === buildAppEntrySource({ root: before.root, language, layout })) {
      await stage(relative, buildAppEntrySource({ root: after.root, language, layout }));
    } else {
      await applyPatch(relative, swapAppEntryRoot(current, after.root, { language, layout }));
    }

    if (after.root === 'welcome') {
      for (const file of await welcomeFiles(after.themed)) {
        const existing = await read(file.path);
        if (existing === null) await stage(file.path, file.content);
        else if (!(await sameAsGenerated(existing, file.content, file.path))) {
          result.kept.push({ file: file.path, reason: 'the app opens on this WelcomeScreen again, as it is' });
        }
      }
    } else {
      const [screen] = await welcomeFiles(before.themed);
      if (screen && (await read(screen.path)) !== null) {
        result.notes.push(
          `${SCREENS_DIR}/WelcomeScreen is no longer what the app opens on — the navigator is. It was left in place; delete it if you don't need it.`,
        );
      }
    }
  } else if (after.root === 'welcome' && before.themed !== after.themed) {
    const was = await welcomeFiles(before.themed);
    const will = await welcomeFiles(after.themed);
    for (const [index, file] of was.entries()) {
      const current = await read(file.path);
      const replacement = will[index];
      if (current === null || !replacement) continue;
      if (await sameAsGenerated(current, file.content, file.path)) await stage(replacement.path, replacement.content);
      else if (adding) {
        result.notes.push(`${file.path} has your changes, so it wasn't switched to the themed version.`);
      }
    }
  }

  // ---- web target -----------------------------------------------------------------------
  const hasWeb = state.platforms.includes('web');
  const webFiles = async (contributions: Composition['web'], dedupe: string[]) => {
    const plan = buildWebScaffoldPlan(state.pkg.dependencies?.react ?? 'latest', dedupe, contributions);
    return language === 'javascript' ? (await convertFilesToJavaScript(plan.filesToWrite)).files : plan.filesToWrite;
  };
  if (hasWeb && JSON.stringify(before.html) !== JSON.stringify(after.html)) {
    const relative = 'web/index.html';
    const current = await read(relative);
    const template = (await webFiles([], [])).find((file) => file.path.endsWith('index.html'))?.content;
    const own = (adding ? after : before).html.filter((entry) => entry.pluginId === target.pluginId);
    if (current === null) {
      block({ rule: 'edit', file: relative, reason: 'the web target has no index.html', manual: 'Run "armemon add web" to create it.' });
    } else if (template !== undefined && current === applyHtmlContributions(template, before.html)) {
      await stage(relative, applyHtmlContributions(template, after.html));
    } else if (own.length > 0) {
      await applyPatch(relative, adding ? addHtmlContributions(current, own) : removeHtmlContributions(current, own));
    }
    if (adding) {
      result.expectations.htmlSnippets = own.flatMap((entry) => [...(entry.head ?? []), ...(entry.bodyStart ?? [])]);
    }
  }

  // ---- runtime registration, config file, guide -----------------------------------------
  {
    const configFile = await findAppConfigFile(appRoot);
    const plugins = { ...state.config.plugins };
    if (adding) plugins[target.pluginId] = (target.plan.recordedAnswers ?? after.plans.find((entry) => entry.pluginId === target.pluginId)?.answers ?? {}) as Record<string, unknown>;
    else delete plugins[target.pluginId];
    const config: ArmemonAppConfig = { ...state.config, plugins };
    if (configFile) await stage(path.relative(appRoot, configFile).split(path.sep).join('/'), serializeAppConfig(config));

    const relative = managedPath(layout, 'README.md');
    const current = await read(relative);
    const guide = (ids: string[]) => managedReadme(layout, { plugins: ids, language });
    const was = guide(Object.keys(state.config.plugins));
    const will = guide(Object.keys(plugins));
    if (current !== null && was !== will) {
      if (current.startsWith(was)) {
        await stage(relative, `${will}${input.commandReference ?? current.slice(was.length)}`);
      } else if (!current.startsWith(will)) {
        result.notes.push(`${relative} was edited, so it doesn't mention this change — it isn't rewritten over your edits.`);
      }
    }
  }

  // ---- linked from a source checkout: Metro and package-manager overrides ----------------
  const pluginPackage = target.plugin.packageName;
  const localDir = (packageName: string) => resolveLocalPackageDir(packageName, { resolveFrom: [CLI_DIR, appRoot] });
  if (state.linkedLocally && isFirstParty(pluginPackage)) {
    const relative = 'metro.config.js';
    const current = await read(relative);
    if (current !== null) {
      try {
        const dirs = (composition: Composition) => [
          '@armemon-library/core',
          ...composition.plans.map((entry) => entry.plugin.packageName).filter(isFirstParty),
          '@armemon-library/config-types',
        ].map(localDir);
        const dir = localDir(pluginPackage);
        if (current === buildMetroConfigSource(dirs(before))) await stage(relative, buildMetroConfigSource(dirs(after)));
        else await applyPatch(relative, patchMetroWatchFolders(current, adding ? { add: [dir] } : { remove: [dir] }));
      } catch (error) {
        block({
          rule: 'edit',
          file: relative,
          reason: `couldn't find ${pluginPackage} next to this CLI (${error instanceof Error ? error.message : String(error)})`,
          manual: `Run armemon from the checkout this app links to.`,
        });
      }
    }
  }

  // ---- dependencies ---------------------------------------------------------------------
  const pkg = state.pkg;
  const installed = (name: string) => pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
  const candidates = new Set<string>();

  if (adding) {
    const wanted: Array<[string, string, 'dependencies' | 'devDependencies']> = [
      ...Object.entries(target.plan.npmDependencies ?? {}).map(([name, version]) => [name, version, 'dependencies'] as [string, string, 'dependencies']),
      ...Object.entries(target.plan.devDependencies ?? {})
        .filter(([name]) => !(language === 'javascript' && name.startsWith('@types/')))
        .map(([name, version]) => [name, version, 'devDependencies'] as [string, string, 'devDependencies']),
    ];
    if (!installed(pluginPackage)) {
      const specifier = isFirstParty(pluginPackage)
        ? buildArmemonDependencySpecifier(pluginPackage, { resolveFrom: [CLI_DIR] })
        : await resolvePluginSpecifier(pluginPackage, appRoot);
      wanted.push([pluginPackage, specifier, 'dependencies']);
    }
    for (const [name, version, field] of wanted) {
      const have = installed(name);
      if (have === undefined) {
        if (field === 'dependencies') result.dependencies.add[name] = version;
        else result.dependencies.addDev[name] = version;
      } else if (have !== version && !result.dependencies.conflicts.some((entry) => entry.name === name)) {
        result.dependencies.conflicts.push({ name, installed: have, wanted: version });
      }
    }
  } else {
    for (const [name, requesters] of before.requestedBy) {
      if (!requesters.includes(target.pluginId) || after.requestedBy.has(name)) continue;
      if (PROTECTED_PACKAGES.has(name) || installed(name) === undefined) continue;
      candidates.add(name);
    }
  }

  // ---- R4: nothing left may still use what goes ---------------------------------------
  if (!adding) {
    const deleted = new Set(result.deletions.map(abs));
    const ownPlan = target.plan;
    const providedAliases = Object.keys(ownPlan.webContributions?.aliases ?? {}).filter(
      (alias) => !after.web.some((entry) => alias in (entry.aliases ?? {})),
    );
    const providedEnvModules = Object.keys(ownPlan.webContributions?.envModules ?? {}).filter(
      (name) => !after.web.some((entry) => name in (entry.envModules ?? {})),
    );
    const tsconfigAliases = readPathAliases(appRoot);
    const importedBy = new Map<string, string>();
    // The plugin's own files that stay: edited ones (R2), and — found below — any the
    // app still imports. Their imports keep what they use: a file that stays never
    // loses a sibling or a package out from under it, so --force leaves code that still
    // resolves. Only the app's own code breaking is a reason to stop (R4).
    const keptOwn = new Set(
      result.blockers.filter((entry) => entry.rule === 'R2' && entry.file).map((entry) => abs(entry.file!)),
    );
    const keptBecauseImported = new Map<string, string>();
    let pluginPackageStillImported = false;

    const queue = (await appSourceFiles(appRoot, layout)).filter((file) => !deleted.has(file));
    const scanned = new Set<string>();
    while (queue.length > 0) {
      const file = queue.shift()!;
      if (scanned.has(file)) continue;
      scanned.add(file);
      const content = await changes.read(file);
      if (content === null) continue;
      const relativeFile = path.relative(appRoot, file).split(path.sep).join('/');
      const where = (line: number) => `${relativeFile}:${line}`;
      const ownFile = keptOwn.has(file) || keptBecauseImported.has(file);
      const block = (blocker: Blocker) => {
        if (!ownFile) result.blockers.push(blocker);
      };

      for (const { specifier, line } of moduleReferences(content, file)) {
        // armemon's own mocks follow the packages — the Jest step below takes them out.
        if (relativeFile === 'jest.setup.js' && JEST_MOCKABLE_PACKAGES.includes(packageNameOf(specifier) ?? '')) continue;
        if (providedEnvModules.includes(specifier)) {
          block({
            rule: 'R4',
            file: where(line),
            reason: `imports '${specifier}', which only the ${target.pluginId} plugin provides`,
            manual: `Stop importing '${specifier}' there, or pass --force to remove the plugin anyway.`,
          });
          continue;
        }
        const alias = providedAliases.find((name) => specifier === name || specifier.startsWith(`${name}/`));
        if (alias) {
          block({
            rule: 'R4',
            file: where(line),
            reason: `imports through ${alias}/, which only the ${target.pluginId} plugin makes work`,
            manual: `Switch that import to a relative path, or pass --force to remove the plugin anyway.`,
          });
          continue;
        }

        let resolved: string | null = null;
        const aliasMatch = specifier.startsWith('.')
          ? undefined
          : tsconfigAliases.find((entry) => specifier.startsWith(entry.prefix));
        if (specifier.startsWith('.')) {
          resolved = await resolveRelativeModule(file, specifier);
        } else if (aliasMatch) {
          const relativeTarget = path
            .relative(path.dirname(file), path.join(aliasMatch.target, specifier.slice(aliasMatch.prefix.length)))
            .split(path.sep)
            .join('/');
          resolved = await resolveRelativeModule(file, relativeTarget.startsWith('.') ? relativeTarget : `./${relativeTarget}`);
        } else {
          const packageName = packageNameOf(specifier);
          if (packageName === pluginPackage) {
            pluginPackageStillImported = true;
            block({
              rule: 'R4',
              file: where(line),
              reason: `imports ${pluginPackage}, the package being removed`,
              manual: `Stop using it there first, or pass --force to remove the plugin and keep the package.`,
            });
          } else if (packageName && candidates.has(packageName) && !importedBy.has(packageName)) {
            importedBy.set(packageName, where(line));
          }
          continue;
        }
        if (resolved && deleted.has(resolved)) {
          block({
            rule: 'R4',
            file: where(line),
            reason: `imports ${path.relative(appRoot, resolved).split(path.sep).join('/')}, which is removed with the plugin`,
            manual: `Stop importing it there first, or pass --force to keep that file.`,
          });
          deleted.delete(resolved);
          keptBecauseImported.set(resolved, where(line));
          queue.push(resolved);
        }
      }
    }

    if (keptBecauseImported.size > 0) {
      result.deletions = result.deletions.filter((relative) => deleted.has(abs(relative)));
      for (const [file, by] of keptBecauseImported) {
        result.kept.push({
          file: path.relative(appRoot, file).split(path.sep).join('/'),
          reason: `still imported by ${by}`,
        });
      }
    }

    // Native code the plugin's tools or notes set up — a launch theme, a storyboard, an
    // init call — keeps needing the package until someone reverts it. Uninstalling the
    // package under it breaks the native build; stop instead, and keep it under --force.
    const nativeReferences = (ownPlan.nativeReferences ?? []).filter(
      (reference) => !after.plans.some((entry) => (entry.plan.nativeReferences ?? []).some((other) => other.marker === reference.marker)),
    );
    if (nativeReferences.length > 0) {
      for (const hit of await findNativeReferences(appRoot, nativeReferences)) {
        result.blockers.push({
          rule: 'R4',
          file: `${hit.file}:${hit.line}`,
          reason: `still uses ${hit.marker}, which needs ${hit.package}`,
          manual: `Revert what the ${target.pluginId} plugin changed in the native projects (git shows which files), or pass --force to remove the plugin and keep ${hit.package} installed.`,
        });
        if (candidates.delete(hit.package)) {
          result.dependencies.kept.push({ name: hit.package, reason: `still used by the native project (${hit.file})` });
        }
      }
    }

    if (candidates.has(pluginPackage) && pluginPackageStillImported) {
      candidates.delete(pluginPackage);
      result.dependencies.kept.push({ name: pluginPackage, reason: 'still imported by the app' });
    }
    for (const name of candidates) {
      const user = importedBy.get(name);
      if (user) {
        result.dependencies.kept.push({ name, reason: `imported by ${user}` });
        candidates.delete(name);
      }
    }

    // R5: a package another installed package peers on stays.
    const remaining = Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }).filter(
      (name) => !candidates.has(name) && name !== pluginPackage,
    );
    const manifestPeers = new Map<string, string>();
    for (const entry of after.plans) {
      for (const peer of entry.plugin.manifest.peerPackages ?? []) manifestPeers.set(peer, entry.plugin.packageName);
    }
    for (const name of remaining) {
      const manifest = await fs
        .readFile(path.join(appRoot, 'node_modules', ...name.split('/'), 'package.json'), 'utf8')
        .then((text) => JSON.parse(text) as PackageJson)
        .catch(() => null);
      for (const peer of Object.keys(manifest?.peerDependencies ?? {})) {
        if (candidates.has(peer) && !manifestPeers.has(peer)) manifestPeers.set(peer, name);
      }
    }
    for (const name of candidates) {
      const dependent = manifestPeers.get(name);
      if (dependent) {
        result.dependencies.kept.push({ name, reason: `a peer dependency of ${dependent}` });
        candidates.delete(name);
      }
    }
    result.dependencies.remove = [...candidates].sort();
  }

  const removedPackages = new Set(result.dependencies.remove);
  const keptPackages = new Set(result.dependencies.kept.map((entry) => entry.name));

  // ---- package.json ---------------------------------------------------------------------
  {
    const next: PackageJson = JSON.parse(JSON.stringify(pkg)) as PackageJson;
    const sorted = (record: Record<string, string>) =>
      Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
    if (Object.keys(result.dependencies.add).length > 0) {
      next.dependencies = sorted({ ...(next.dependencies ?? {}), ...result.dependencies.add });
    }
    if (Object.keys(result.dependencies.addDev).length > 0) {
      next.devDependencies = sorted({ ...(next.devDependencies ?? {}), ...result.dependencies.addDev });
    }
    for (const name of removedPackages) {
      if (next.dependencies) delete next.dependencies[name];
      if (next.devDependencies) delete next.devDependencies[name];
    }
    if (scriptsChanged) next.scripts = scripts;

    // Overrides force a linked package onto the one on disk; see initReactNative.ts.
    if (state.linkedLocally && isFirstParty(pluginPackage)) {
      const field = state.packageManager === 'pnpm' ? 'pnpm' : state.packageManager === 'yarn' ? 'resolutions' : 'overrides';
      const existing = field === 'pnpm' ? next.pnpm?.overrides : next[field];
      const specifier = result.dependencies.add[pluginPackage];
      if (adding && specifier && existing?.[pluginPackage] === undefined) {
        const overrides = { ...(existing ?? {}), [pluginPackage]: specifier };
        if (field === 'pnpm') next.pnpm = { ...(next.pnpm ?? {}), overrides };
        else next[field] = overrides;
      }
      if (!adding && removedPackages.has(pluginPackage) && existing?.[pluginPackage] !== undefined) {
        const overrides = { ...existing };
        delete overrides[pluginPackage];
        if (field === 'pnpm') next.pnpm = { ...(next.pnpm ?? {}), overrides };
        else next[field] = overrides;
      }
    }

    const text = `${JSON.stringify(next, null, 2)}\n`;
    const current = await read('package.json');
    if (current !== null && JSON.stringify(JSON.parse(current)) !== JSON.stringify(next)) await stage('package.json', text);
  }

  // ---- web/vite.config — after dependencies, since dedupe follows them -------------------
  if (hasWeb) {
    const relative = `web/vite.config.${language === 'javascript' ? 'js' : 'ts'}`;
    const current = await read(relative);
    const dedupe = current === null ? null : readViteDedupe(current, relative);
    const aliasesOf = (composition: Composition) => Object.assign({}, ...composition.web.map((entry) => entry.aliases ?? {})) as Record<string, string>;
    const envOf = (composition: Composition) => Object.assign({}, ...composition.web.map((entry) => entry.envModules ?? {})) as Record<string, string>;
    const addDedupe = adding
      ? (target.plugin.manifest.peerPackages ?? []).filter((name) => !isFirstParty(name) && !(dedupe ?? []).includes(name))
      : [];
    const removeDedupe = (dedupe ?? []).filter((name) => removedPackages.has(name));
    const webChanged =
      JSON.stringify(aliasesOf(before)) !== JSON.stringify(aliasesOf(after)) ||
      JSON.stringify(envOf(before)) !== JSON.stringify(envOf(after)) ||
      addDedupe.length > 0 ||
      removeDedupe.length > 0;

    if (current !== null && webChanged) {
      const nextDedupe = [...(dedupe ?? []).filter((name) => !removeDedupe.includes(name)), ...addDedupe];
      const was = dedupe === null ? undefined : (await webFiles(before.web, dedupe)).find((file) => file.path === relative)?.content;
      if (was !== undefined && current === was) {
        const will = (await webFiles(after.web, nextDedupe)).find((file) => file.path === relative)!.content;
        await stage(relative, will);
      } else {
        const beforeAliases = aliasesOf(before);
        const afterAliases = aliasesOf(after);
        const beforeEnv = envOf(before);
        const afterEnv = envOf(after);
        await applyPatch(
          relative,
          patchViteConfig(
            current,
            {
              addAliases: Object.fromEntries(Object.entries(afterAliases).filter(([name]) => !(name in beforeAliases))),
              removeAliases: Object.keys(beforeAliases).filter((name) => !(name in afterAliases)),
              addEnvModules: Object.fromEntries(Object.entries(afterEnv).filter(([name]) => !(name in beforeEnv))),
              removeEnvModules: Object.keys(beforeEnv).filter((name) => !(name in afterEnv)),
              addDedupe,
              removeDedupe,
            },
            relative,
          ),
        );
      }
    }
  }

  // ---- Jest -----------------------------------------------------------------------------
  {
    const mocksOf = (composition: Composition) =>
      JEST_MOCKABLE_PACKAGES.filter((name) => name in composition.dependencies);
    const was = mocksOf(before);
    const will = [...new Set([...mocksOf(after), ...was.filter((name) => keptPackages.has(name))])];
    const add = will.filter((name) => !was.includes(name));
    const remove = was.filter((name) => !will.includes(name));
    const current = await read('jest.setup.js');
    if (current !== null && (add.length > 0 || remove.length > 0)) {
      const probe = officialMockProbe(appRoot);
      if (current === buildJestSetupSource(was, probe)) {
        result.jest = { regenerate: will, add, remove };
      } else {
        const check = patchJestSetup(current, { add, remove }, probe);
        if (!check.changed && !check.already) {
          block({ rule: 'edit', file: 'jest.setup.js', reason: check.reason ?? "couldn't be edited safely", manual: check.manual });
        } else {
          result.jest = { regenerate: null, add, remove };
        }
      }
    }

    const resolverCurrent = state.linkedLocally ? await read('jest.resolver.js') : null;
    if (resolverCurrent !== null) {
      const pinsOf = (composition: Composition, extra: string[] = []) =>
        [...composition.peerPackages, ...JEST_MOCKABLE_PACKAGES].filter(
          (name) => name in composition.dependencies || extra.includes(name),
        );
      const pinsBefore = pinsOf(before);
      const pinsAfter = pinsOf(after, pinsBefore.filter((name) => keptPackages.has(name)));
      const listBefore = jestResolverPins(pinsBefore);
      const listAfter = jestResolverPins(pinsAfter);
      if (JSON.stringify(listBefore) !== JSON.stringify(listAfter)) {
        if (resolverCurrent === buildJestResolverSource(pinsBefore)) {
          await stage('jest.resolver.js', buildJestResolverSource(pinsAfter));
        } else {
          await applyPatch(
            'jest.resolver.js',
            patchJestResolverPins(resolverCurrent, {
              add: listAfter.filter((name) => !listBefore.includes(name)),
              remove: listBefore.filter((name) => !listAfter.includes(name)),
            }),
          );
        }
      }
    }
  }

  // ---- the examples folder's README -----------------------------------------------------
  {
    const readme = `${EXAMPLES_DIR}/README.md`;
    const inExamples = (relative: string) => relative.startsWith(`${EXAMPLES_DIR}/`) && relative !== readme;
    const current = await read(readme);
    if (adding && result.created.some(inExamples) && current === null) {
      await stage(readme, examplesReadme(layout));
    }
    if (!adding && result.deletions.some(inExamples) && current === examplesReadme(layout)) {
      const left = (await fs.readdir(abs(EXAMPLES_DIR), { recursive: true }).catch(() => [] as string[]))
        .map((entry) => `${EXAMPLES_DIR}/${String(entry).split(path.sep).join('/')}`)
        .filter((relative) => inExamples(relative) && !result.deletions.includes(relative));
      const files = await Promise.all(left.map(async (relative) => ((await fs.stat(abs(relative))).isFile() ? relative : null)));
      if (files.every((entry) => entry === null)) result.deletions.push(readme);
    }
  }

  // Everything the plugin contributes to a file is only half the story; its notes are the rest.
  return result;
}

const NATIVE_ROOTS = ['android', 'ios', 'macos', 'windows'];
const NATIVE_SKIP = new Set(['build', 'Pods', 'DerivedData', '.gradle', '.cxx', 'node_modules', 'Generated']);
const NATIVE_TEXT = /\.(xml|java|kt|kts|gradle|plist|pbxproj|m|mm|h|swift|storyboard|xib|cpp|cs|xaml)$/;

/** Every place a native project mentions one of these markers, first hit per file and marker. */
async function findNativeReferences(
  appRoot: string,
  references: Array<{ marker: string; package: string }>,
): Promise<Array<{ file: string; line: number; marker: string; package: string }>> {
  const hits: Array<{ file: string; line: number; marker: string; package: string }> = [];
  const visit = async (relative: string): Promise<void> => {
    const entries = await fs.readdir(path.join(appRoot, ...relative.split('/')), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const child = `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!NATIVE_SKIP.has(entry.name)) await visit(child);
      } else if (NATIVE_TEXT.test(entry.name)) {
        const content = await fs.readFile(path.join(appRoot, ...child.split('/')), 'utf8').catch(() => '');
        for (const reference of references) {
          const at = content.indexOf(reference.marker);
          if (at !== -1) hits.push({ file: child, line: content.slice(0, at).split('\n').length, ...reference });
        }
      }
    }
  };
  for (const root of NATIVE_ROOTS) await visit(root);
  return hits;
}
