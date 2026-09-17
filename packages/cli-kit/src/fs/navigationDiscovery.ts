/**
 * FILE: navigationDiscovery.ts
 * PATH: packages/cli-kit/src/fs/navigationDiscovery.ts
 *
 * WHAT: Maps an app's navigation as it is on disk: every navigator reachable from
 *       RootNavigator through relative imports and re-exports, the file that renders
 *       it, the routes it registers, the file that declares its param list, and the
 *       chain of routes it is nested under.
 * WHY:  Real apps outgrow one RootNavigator — a stack per tab in its own file, reached
 *       through a `navigation/index.ts` barrel, is the usual next step. A screen added to
 *       a tab has to be registered in THAT file, typed in THAT navigator's param list,
 *       and deep-linked under its parent route: React Navigation resolves a flat entry
 *       for a nested screen to a root route the root navigator doesn't have, so the
 *       link opens nothing. A navigator can also be rendered inline, straight from a
 *       screen's children, and a root navigator can be untyped while the app types its
 *       routes through the global RootParamList — both are mapped here.
 * HOW:  Breadth-first over relative imports, starting at RootNavigator and following
 *       files that mention a navigator or re-export something (everything else is a
 *       leaf). Imports are resolved through re-exports to the file that declares them.
 *       Each file is parsed once; the contents are returned so callers edit without
 *       re-reading.
 * WHEN: At the start of `armemon create-screen`, `remove-screen` and `rename-screen`.
 *
 * EXPORTS: NavigatorLocation, NavigationMap, discoverNavigation, resolveRelativeModule,
 *          appSourceFiles, importsNameFrom
 * DEPENDS ON: node:path, node:fs/promises, typescript, ./navigatorPatcher, ./sourceEdit
 * USED BY: packages/cli-armemon/src/flows/*Screen.ts
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import ts from 'typescript';
import {
  NAVIGATOR_FACTORIES,
  type DetectedNavigator,
  type NavigatorDeclaration,
  detectNavigators,
  navigatorDeclarations,
} from './navigatorPatcher.js';
import type { AppLayout } from '@armemon-library/config-types';
import { readLayout } from './layout.js';
import { type ImportBinding, declaresType, importBindings, parseSource, sourceSyntaxErrors, walk } from './sourceEdit.js';

export interface NavigatorLocation extends DetectedNavigator {
  /** Absolute path of the file that renders the navigator. */
  file: string;
  /** Absolute path of the file declaring the param list, when there is one. */
  paramListFile: string | null;
  /** The param list's name where it is declared (an import may rename it). */
  paramListName: string | null;
  /** True when the param list is the app's global RootParamList, not the navigator's own type argument. */
  paramListInferred: boolean;
  /** Route names from the root navigator down to this one: [] for the root, null when unknown. */
  nesting: string[] | null;
  screenProps: { type: string; package: string };
}

export interface NavigationMap {
  rootFile: string | null;
  linkingFile: string | null;
  navigators: NavigatorLocation[];
  /** Navigation files that don't parse; nothing in them is edited. */
  unparsable: string[];
  /** Everything read, by absolute path. */
  sources: Map<string, string>;
  /** The param list `declare global { namespace ReactNavigation { interface RootParamList extends … } }` names. */
  rootParamList: { file: string; name: string } | null;
}

const EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'];
const REEXPORTS = /\bexport\s*(?:type\s*)?(?:\*|\{[^}]*\})\s*(?:as\s+[\w$]+\s*)?from\s*['"]/;

interface Reexport {
  exported: string;
  imported: string;
  module: string;
}

interface Resolved {
  file: string;
  name: string;
}

async function isFile(target: string): Promise<boolean> {
  return fs.stat(target).then((stat) => stat.isFile()).catch(() => false);
}

async function firstExisting(base: string): Promise<string | null> {
  for (const extension of EXTENSIONS) {
    if (await isFile(`${base}${extension}`)) return `${base}${extension}`;
  }
  return null;
}

export async function resolveRelativeModule(fromFile: string, spec: string): Promise<string | null> {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  if (/\.[jt]sx?$/.test(base) && (await isFile(base))) return base;
  return (await firstExisting(base)) ?? firstExisting(path.join(base, 'index'));
}

/** Folders outside src/ whose code reaches into it: tests, most of all. */
const TEST_DIRECTORIES = ['__tests__', 'e2e', 'test', 'tests'];

const isSourceFile = (name: string) => /\.[jt]sx?$/.test(name) && !name.endsWith('.d.ts');

/**
 * Every source file the app owns — the author's zone, the managed zone, the files at
 * the app root, and the test folders beside them. What references are searched in.
 *
 * The root and the test folders used to be left out, apart from App: so a test that
 * imported or jest.mock()ed a screen or a managed module by path was never updated
 * when that module was renamed, removed or moved, and neither was the root index.js
 * or jest.setup.js.
 */
export async function appSourceFiles(appRoot: string, layout?: AppLayout): Promise<string[]> {
  const files: string[] = [];
  const visit = async (directory: string) => {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (isSourceFile(entry.name)) files.push(full);
    }
  };
  await visit(path.join(appRoot, 'src'));
  const managed = (layout ?? (await readLayout(appRoot))).managed;
  if (!managed.startsWith('src/')) await visit(path.join(appRoot, ...managed.split('/')));
  for (const directory of TEST_DIRECTORIES) await visit(path.join(appRoot, directory));

  // The root itself, one level only: App, index.js, jest.setup.js and the rest. Not
  // tooling configs (babel.config.js, armemon.config.ts): they import no app code,
  // and a path they name is text for a person to change, not a specifier.
  const rootEntries = await fs.readdir(appRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of rootEntries) {
    if (entry.isFile() && isSourceFile(entry.name) && !/\.config\.[cm]?[jt]s$/.test(entry.name)) {
      files.push(path.join(appRoot, entry.name));
    }
  }
  return files;
}

/**
 * Whether a file takes `name` from `module` (an absolute path): by name, through a
 * namespace import, or by passing it on with a re-export. An import armemon can't
 * resolve — a path alias — that brings in the same name counts too: keeping a barrel
 * line is safer than deleting one something still needs.
 */
export async function importsNameFrom(content: string, filePath: string, module: string, name: string): Promise<boolean> {
  const file = parseSource(content, filePath);
  for (const statement of file.statements) {
    const isImport = ts.isImportDeclaration(statement);
    if ((!isImport && !ts.isExportDeclaration(statement)) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;

    const names: string[] = [];
    let everything = false;
    if (ts.isImportDeclaration(statement)) {
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) everything = true;
      else if (bindings) names.push(...bindings.elements.map((element) => (element.propertyName ?? element.name).text));
    } else if (ts.isExportDeclaration(statement)) {
      const clause = statement.exportClause;
      if (!clause || !ts.isNamedExports(clause)) everything = true;
      else names.push(...clause.elements.map((element) => (element.propertyName ?? element.name).text));
    }
    if (!everything && !names.includes(name)) continue;

    const spec = statement.moduleSpecifier.text;
    if (!spec.startsWith('.')) {
      if (names.includes(name)) return true;
      continue;
    }
    if ((await resolveRelativeModule(filePath, spec)) === module) return true;
  }
  return false;
}

/** Whether a module exports `name` itself, rather than re-exporting it. */
function exportsName(source: ts.SourceFile, name: string): boolean {
  for (const statement of source.statements) {
    if (name === 'default' && ts.isExportAssignment(statement) && !statement.isExportEquals) return true;
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) ?? [] : [];
    const exported = modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    const isDefault = modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword);
    if (exported && isDefault) {
      if (name === 'default') return true;
      continue;
    }
    if (exported) {
      if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isTypeAliasDeclaration(statement) ||
          ts.isInterfaceDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name?.text === name) {
        return true;
      }
      if (ts.isVariableStatement(statement) &&
          statement.declarationList.declarations.some((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name)) {
        return true;
      }
    }
    if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause &&
        ts.isNamedExports(statement.exportClause) && statement.exportClause.elements.some((element) => element.name.text === name)) {
      return true;
    }
  }
  return false;
}

export async function discoverNavigation(
  appRoot: string,
  options: { maxFiles?: number; layout?: AppLayout } = {},
): Promise<NavigationMap> {
  const layout = options.layout ?? (await readLayout(appRoot));
  const navigationDir = path.join(appRoot, ...layout.managed.split('/'), 'navigation');
  const rootFile = await firstExisting(path.join(navigationDir, 'RootNavigator'));
  const linkingFile = await firstExisting(path.join(navigationDir, 'navigation.config'));
  const sources = new Map<string, string>();
  const unparsable: string[] = [];
  const map: NavigationMap = { rootFile, linkingFile, navigators: [], unparsable, sources, rootParamList: null };
  if (!rootFile) return map;

  const parsed = new Map<string, ts.SourceFile>();
  const load = async (file: string): Promise<ts.SourceFile | null> => {
    const cached = parsed.get(file);
    if (cached) return cached;
    const content = sources.get(file) ?? (await fs.readFile(file, 'utf8').catch(() => null));
    if (content === null) return null;
    sources.set(file, content);
    const source = parseSource(content, file);
    parsed.set(file, source);
    return source;
  };

  const reexportCache = new Map<string, Reexport[]>();
  const reexportsOf = async (file: string): Promise<Reexport[]> => {
    const cached = reexportCache.get(file);
    if (cached) return cached;
    const list: Reexport[] = [];
    for (const statement of (await load(file))?.statements ?? []) {
      if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const module = statement.moduleSpecifier.text;
      if (!statement.exportClause) {
        list.push({ exported: '*', imported: '*', module });
      } else if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          list.push({ exported: element.name.text, imported: (element.propertyName ?? element.name).text, module });
        }
      }
    }
    reexportCache.set(file, list);
    return list;
  };

  /** Follows re-exports to the file that really declares `name`. */
  const resolveExport = async (file: string, name: string, depth = 0): Promise<Resolved | null> => {
    if (depth > 8) return null;
    const source = await load(file);
    if (!source) return null;
    const list = await reexportsOf(file);
    const explicit = list.find((entry) => entry.exported === name);
    if (explicit) {
      const target = await resolveRelativeModule(file, explicit.module);
      return target ? resolveExport(target, explicit.imported, depth + 1) : null;
    }
    if (exportsName(source, name)) return { file, name };
    for (const entry of list.filter((item) => item.exported === '*')) {
      const target = await resolveRelativeModule(file, entry.module);
      const found = target ? await resolveExport(target, name, depth + 1) : null;
      if (found) return found;
    }
    return null;
  };

  const resolveImport = async (file: string, binding: ImportBinding): Promise<Resolved | null> => {
    const target = await resolveRelativeModule(file, binding.module);
    if (!target) return null;
    return (await resolveExport(target, binding.imported)) ?? { file: target, name: binding.imported };
  };

  // ---- walk the imports -----------------------------------------------------------
  // Anywhere in the app, not just src/: the root navigator is in the managed zone and
  // the screens it renders are in the author's, so the walk crosses between them.
  const limit = options.maxFiles ?? 500;
  const visited = new Set<string>();
  const navigatorFiles: string[] = [];
  const queue = [rootFile];

  while (queue.length > 0 && visited.size < limit) {
    const file = queue.shift()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const content = sources.get(file) ?? (await fs.readFile(file, 'utf8').catch(() => null));
    if (content === null) continue;
    sources.set(file, content);

    // A file that neither mentions a navigator nor re-exports anything can't build or
    // render one, and can't lead to one either.
    const mentionsNavigator = content.includes('Navigator');
    if (!mentionsNavigator && !REEXPORTS.test(content)) continue;
    if (sourceSyntaxErrors(content, file).length > 0) {
      if (mentionsNavigator) unparsable.push(file);
      continue;
    }
    const source = await load(file);
    if (!source) continue;
    if (mentionsNavigator) navigatorFiles.push(file);

    for (const statement of source.statements) {
      if ((!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) || !statement.moduleSpecifier ||
          !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const target = await resolveRelativeModule(file, statement.moduleSpecifier.text);
      const inApp = target?.startsWith(`${appRoot}${path.sep}`) && !target.includes(`${path.sep}node_modules${path.sep}`);
      if (target && inApp && !visited.has(target)) queue.push(target);
    }
  }

  // ---- what each import really is ---------------------------------------------------
  const resolvedBindings = new Map<string, Map<string, Resolved | null>>();
  const declarationCache = new Map<string, Map<string, NavigatorDeclaration>>();
  const declarationsOf = async (file: string) => {
    const cached = declarationCache.get(file);
    if (cached) return cached;
    const source = await load(file);
    const found = source ? navigatorDeclarations(source.text, file) : new Map<string, NavigatorDeclaration>();
    declarationCache.set(file, found);
    return found;
  };

  for (const file of navigatorFiles) {
    const bindings = new Map<string, Resolved | null>();
    for (const binding of importBindings(parsed.get(file)!)) {
      const resolved = await resolveImport(file, binding);
      bindings.set(binding.local, resolved);
      if (resolved) await declarationsOf(resolved.file);
    }
    resolvedBindings.set(file, bindings);
    await declarationsOf(file);
  }

  const typeLocation = async (file: string, typeName: string): Promise<Resolved | null> => {
    const source = await load(file);
    if (!source) return null;
    if (declaresType(source, typeName)) return { file, name: typeName };
    const binding = importBindings(source).find((entry) => entry.local === typeName);
    const resolved = binding ? await resolveImport(file, binding) : null;
    const declaring = resolved ? await load(resolved.file) : null;
    return resolved && declaring && declaresType(declaring, resolved.name) ? resolved : null;
  };

  // ---- the navigators ---------------------------------------------------------------
  for (const file of navigatorFiles) {
    const bindings = resolvedBindings.get(file)!;
    const found = detectNavigators(sources.get(file)!, file, (binding) => {
      const resolved = bindings.get(binding.local);
      return (resolved && declarationCache.get(resolved.file)?.get(resolved.name)) || null;
    });

    for (const navigator of found) {
      // Declared here but rendered elsewhere: the rendering file reports it.
      if (navigator.elements === 0 && !(navigator.isStatic && navigator.declaredHere)) continue;

      const factoryFile = navigator.declaredHere ? file : (bindings.get(navigator.variable)?.file ?? null);
      const list = navigator.paramListType && factoryFile ? await typeLocation(factoryFile, navigator.paramListType) : null;
      const factory = NAVIGATOR_FACTORIES[navigator.factory]!;
      map.navigators.push({
        ...navigator,
        file,
        paramListFile: list?.file ?? null,
        paramListName: list?.name ?? null,
        paramListInferred: false,
        nesting: null,
        screenProps: { type: factory.screenPropsType, package: factory.package },
      });
    }
  }

  // ---- how they nest --------------------------------------------------------------------
  const rendersHost = (parentFile: string, component: string, child: NavigatorLocation): boolean => {
    if (!child.host) return false;
    if (parentFile === child.file) return component === child.host;
    const resolved = resolvedBindings.get(parentFile)?.get(component);
    if (!resolved || resolved.file !== child.file) return false;
    return resolved.name === 'default' ? child.hostExport === 'default' : resolved.name === child.host;
  };

  const renderedBySomething = (navigator: NavigatorLocation) =>
    navigator.renderedBy !== null ||
    map.navigators.some((parent) => parent !== navigator &&
      parent.routes.some((route) => route.component !== null && rendersHost(parent.file, route.component, navigator)));

  const inRoot = map.navigators.filter((navigator) => navigator.file === rootFile && navigator.renderedBy === null);
  const roots = new Set(
    inRoot.some((navigator) => navigator.hostExport === 'default')
      ? inRoot.filter((navigator) => navigator.hostExport === 'default')
      : inRoot.filter((navigator) => !renderedBySomething(navigator)),
  );

  const nestingOf = (navigator: NavigatorLocation, seen: Set<NavigatorLocation>): string[] | null => {
    if (seen.has(navigator)) return null;
    const next = new Set([...seen, navigator]);
    if (navigator.renderedBy) {
      const { variable, route } = navigator.renderedBy;
      const parent = map.navigators.find((candidate) => candidate.file === navigator.file && candidate.variable === variable);
      const chain = parent ? nestingOf(parent, next) : null;
      return chain ? [...chain, route] : null;
    }
    if (roots.has(navigator)) return [];
    for (const parent of map.navigators) {
      if (parent === navigator) continue;
      for (const route of parent.routes) {
        if (!route.component || !rendersHost(parent.file, route.component, navigator)) continue;
        const chain = nestingOf(parent, next);
        if (chain) return [...chain, route.name];
      }
    }
    return null;
  };

  for (const navigator of map.navigators) navigator.nesting = nestingOf(navigator, new Set());

  // ---- the app's global param list, for navigators that don't name their own ------------
  const typesFile = await firstExisting(path.join(navigationDir, 'types'));
  for (const file of new Set([...(typesFile ? [typesFile] : []), ...navigatorFiles])) {
    const source = await load(file);
    if (!source || !source.text.includes('RootParamList')) continue;
    const found: { name?: string } = {};
    walk(source, (node) => {
      if (found.name || !ts.isInterfaceDeclaration(node) || node.name.text !== 'RootParamList') return;
      const heritage = node.heritageClauses?.[0]?.types[0]?.expression;
      if (heritage && ts.isIdentifier(heritage)) found.name = heritage.text;
    });
    const location = found.name ? await typeLocation(file, found.name) : null;
    if (location) {
      map.rootParamList = location;
      break;
    }
  }

  if (map.rootParamList) {
    for (const navigator of map.navigators) {
      if (navigator.paramListType !== null || navigator.nesting?.length !== 0) continue;
      navigator.paramListFile = map.rootParamList.file;
      navigator.paramListName = map.rootParamList.name;
      navigator.paramListInferred = true;
    }
  }

  return map;
}
