/**
 * FILE: navigatorPatcher.ts
 * PATH: packages/cli-kit/src/fs/navigatorPatcher.ts
 *
 * WHAT: Reads and edits an app's navigation source — which navigators a file builds
 *       and what they register — and adds, updates, removes or renames a screen in a
 *       navigator, a route in a param list, and a path in a deep-linking config.
 * WHY:  Creating a screen is four edits and three of them are the ones people forget;
 *       removing or renaming one is the same edits in reverse. These files belong to
 *       the app author, so everything here reads what is on disk rather than the shape
 *       armemon once wrote: Prettier formatting, groups, conditional screens, doc
 *       comments full of example screens, destructured navigators
 *       (`const { Navigator, Screen } = createX()`), navigators rendered inline inside
 *       another navigator's screen, and linking configs written by hand.
 *
 *       The first version anchored regexes on lines. An audit against init's real
 *       output showed what that costs: an example `screens: {` inside a comment made
 *       every generated linking config look "nested", an example `name="Settings"`
 *       made Settings look registered, and an example `RootStackParamList` sent stack
 *       routes into TabParamList.
 * HOW:  Parse with the TypeScript compiler (see sourceEdit), locate nodes, splice text.
 *       Pure — string in, PatchResult out, never throws. An edit whose result would not
 *       parse is refused; anything ambiguous comes back unchanged with a reason and
 *       the exact text to add by hand. `conflict` marks the refusals that must stop a
 *       command before it writes anything. Re-running with new options updates what
 *       is there instead of reporting "already".
 * WHEN: Called by `armemon create-screen`, `remove-screen` and `rename-screen`.
 *
 * EXPORTS: NAVIGATOR_FACTORIES, NavigatorKind, NavigatorFactory, NavigatorDeclaration,
 *          DetectedRoute, DetectedNavigator, PatchResult, navigatorDeclarations,
 *          detectNavigators, registerScreenInNavigator, unregisterScreenFromNavigator,
 *          renameScreenInNavigator, addRouteToParamList, removeRouteFromParamList,
 *          renameRouteInParamList, addLinkingRoute, nestLinkingRoutes,
 *          removeLinkingRoute, renameLinkingRoute, linkingPathOf
 * DEPENDS ON: node:path, typescript, ./sourceEdit
 * USED BY: ./navigationDiscovery.ts, packages/cli-armemon/src/flows/*Screen.ts
 */

import path from 'node:path';
import ts from 'typescript';
import {
  type ImportBinding,
  type SourceValue,
  type TextEdit,
  applyEdits,
  blockInsertion,
  defaultImportInsertion,
  eolOf,
  findProperty,
  identifierRenames,
  importBindings,
  indentAt,
  indentUnitOf,
  jsxAttribute,
  jsxIdentifierAttribute,
  jsxOpening,
  jsxStringAttribute,
  jsxStringLiteralOf,
  jsxTag,
  keyText,
  lineAfter,
  namedImportInsertion,
  parseSource,
  propertyInsertion,
  propertyName,
  quoteString,
  removalOf,
  renderValue,
  samePathSpec,
  sourceSyntaxErrors,
  stringQuoteOf,
  topLevelDeclarationNames,
  unusedImportRemoval,
  walk,
} from './sourceEdit.js';
import { brokenReason, checked, done, finish, refused, type PatchResult } from './patchResult.js';

// Declared in patchResult.ts so the store-config patcher shares the exact same
// refusal semantics, and re-exported here so consumers keep importing it from one
// place.
export type { PatchResult };

export type NavigatorKind = 'stack' | 'tabs' | 'drawer';

export interface NavigatorFactory {
  kind: NavigatorKind;
  /** The props type a screen component rendered by this navigator receives. */
  screenPropsType: string;
  /** The package both the factory and that props type come from. */
  package: string;
}

export const NAVIGATOR_FACTORIES: Record<string, NavigatorFactory> = {
  createNativeStackNavigator: { kind: 'stack', screenPropsType: 'NativeStackScreenProps', package: '@react-navigation/native-stack' },
  createStackNavigator: { kind: 'stack', screenPropsType: 'StackScreenProps', package: '@react-navigation/stack' },
  createBottomTabNavigator: { kind: 'tabs', screenPropsType: 'BottomTabScreenProps', package: '@react-navigation/bottom-tabs' },
  createMaterialTopTabNavigator: { kind: 'tabs', screenPropsType: 'MaterialTopTabScreenProps', package: '@react-navigation/material-top-tabs' },
  createDrawerNavigator: { kind: 'drawer', screenPropsType: 'DrawerScreenProps', package: '@react-navigation/drawer' },
};

export interface DetectedRoute {
  name: string;
  /** The component it renders: component={X}, or the element its children render. */
  component: string | null;
}

/** `const Stack = createNativeStackNavigator<RootStackParamList>()` */
export interface NavigatorDeclaration {
  factory: string;
  /** The type argument, e.g. RootStackParamList; null when the navigator is untyped. */
  paramListType: string | null;
  /** React Navigation 7's static API: createXNavigator({ screens: {...} }). */
  isStatic: boolean;
  staticRoutes: DetectedRoute[];
  /** `const { Navigator, Screen } = createX()`: the local names its components are bound to. */
  destructured: { navigator: string | null; screen: string | null; group: string | null } | null;
}

export interface DetectedNavigator {
  /** The factory's variable — `Stack` — or, when destructured, the Navigator binding. */
  variable: string;
  /** How its JSX is written: Stack.Navigator and Stack.Screen, or Navigator and Screen. */
  navigatorTag: string;
  screenTag: string;
  kind: NavigatorKind;
  factory: string;
  /** False when the factory call lives in another file and is imported here. */
  declaredHere: boolean;
  paramListType: string | null;
  isStatic: boolean;
  /** The component whose JSX renders the navigator. */
  host: string | null;
  hostExport: 'default' | 'named' | null;
  initialRouteName: string | null;
  routes: DetectedRoute[];
  /** How many navigator elements the file renders. */
  elements: number;
  /** Rendered inline by another navigator's screen: <Stack.Screen name="Main">{() => <Tab.Navigator>…}. */
  renderedBy: { variable: string; route: string } | null;
}

type JsxLike = ts.JsxElement | ts.JsxSelfClosingElement;

function jsxElements(file: ts.SourceFile, matches: (tag: string) => boolean): JsxLike[] {
  const found: JsxLike[] = [];
  walk(file, (node) => {
    if ((ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) && matches(jsxTag(node))) found.push(node);
  });
  return found;
}

/** The quote JSX attributes in this file use; double when there are none. */
function jsxQuoteOf(file: ts.SourceFile): string {
  let quote: string | null = null;
  walk(file, (node) => {
    if (quote || !ts.isJsxAttribute(node) || !node.initializer || !ts.isStringLiteral(node.initializer)) return;
    quote = file.text[node.initializer.getStart(file)] === "'" ? "'" : '"';
  });
  return quote ?? '"';
}

/** Replaces a string literal's value, keeping its own quote character. */
function literalReplacement(file: ts.SourceFile, literal: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral, value: string): TextEdit {
  const start = literal.getStart(file);
  const quote = file.text[start] ?? "'";
  return { start, end: literal.getEnd(), text: quote === '`' ? `\`${value}\`` : quoteString(value, quote) };
}

const isStringy = (node: ts.Node | undefined): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral =>
  node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node));

function hostOf(node: ts.Node, file: ts.SourceFile): { name: string | null; exported: 'default' | 'named' | null } {
  const exportKindOf = (name: string): 'default' | 'named' | null => {
    for (const statement of file.statements) {
      if (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression) && statement.expression.text === name) {
        return 'default';
      }
      if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          if ((element.propertyName ?? element.name).text === name) return element.name.text === 'default' ? 'default' : 'named';
        }
      }
    }
    return null;
  };
  const modifierKinds = (target: ts.Node) =>
    (ts.canHaveModifiers(target) ? ts.getModifiers(target) ?? [] : []).map((modifier) => modifier.kind);

  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if (ts.isFunctionDeclaration(current) || ts.isClassDeclaration(current)) {
      const kinds = modifierKinds(current);
      const name = current.name?.text ?? null;
      if (kinds.includes(ts.SyntaxKind.DefaultKeyword)) return { name: name ?? 'default', exported: 'default' };
      if (kinds.includes(ts.SyntaxKind.ExportKeyword)) return { name, exported: 'named' };
      return { name, exported: name ? exportKindOf(name) : null };
    }
    if ((ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
        ts.isVariableDeclaration(current.parent) && ts.isIdentifier(current.parent.name)) {
      const name = current.parent.name.text;
      const statement = current.parent.parent.parent;
      if (statement && modifierKinds(statement).includes(ts.SyntaxKind.ExportKeyword)) return { name, exported: 'named' };
      return { name, exported: exportKindOf(name) };
    }
    if (ts.isExportAssignment(current)) return { name: 'default', exported: 'default' };
  }
  return { name: null, exported: null };
}

/**
 * The component a screen renders through its children — `{() => <OrderScreen />}`.
 * Only the outermost element counts: a screen whose children render a navigator
 * renders that navigator, not the first screen inside it.
 */
function childComponentOf(element: ts.JsxElement): string | null {
  const found: { opening?: ts.JsxOpeningLikeElement } = {};
  for (const child of element.children) {
    walk(child, (node) => {
      if (!found.opening && (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node))) found.opening = jsxOpening(node);
    });
    if (found.opening) break;
  }
  const tag = found.opening?.tagName;
  return tag && ts.isIdentifier(tag) && /^[A-Z]/.test(tag.text) ? tag.text : null;
}

type Role = 'Navigator' | 'Screen' | 'Group';
type RoleOf = (tag: string) => { variable: string; role: Role } | null;

/** Recognises Stack.Screen, and Screen from `const { Screen } = createX()`. */
function tagRoles(declarations: Map<string, NavigatorDeclaration>): RoleOf {
  const destructured = new Map<string, { variable: string; role: Role }>();
  for (const [variable, declaration] of declarations) {
    const names = declaration.destructured;
    if (!names) continue;
    if (names.navigator) destructured.set(names.navigator, { variable, role: 'Navigator' });
    if (names.screen) destructured.set(names.screen, { variable, role: 'Screen' });
    if (names.group) destructured.set(names.group, { variable, role: 'Group' });
  }
  return (tag) => {
    const dotted = /^([A-Za-z_$][\w$]*)\.(Navigator|Screen|Group)$/.exec(tag);
    if (dotted?.[1]) return { variable: dotted[1], role: dotted[2] as Role };
    return destructured.get(tag) ?? null;
  };
}

function tagsFor(variable: string, declaration: NavigatorDeclaration | undefined): { navigatorTag: string; screenTag: string } {
  const names = declaration?.destructured;
  return {
    navigatorTag: names?.navigator ?? `${variable}.Navigator`,
    screenTag: names?.screen ?? `${variable}.Screen`,
  };
}

function declarationsIn(file: ts.SourceFile): Map<string, NavigatorDeclaration> {
  const declarations = new Map<string, NavigatorDeclaration>();

  walk(file, (node) => {
    if (!ts.isVariableDeclaration(node) || !node.initializer) return;
    if (!ts.isCallExpression(node.initializer) || !ts.isIdentifier(node.initializer.expression)) return;
    const factory = node.initializer.expression.text;
    if (!NAVIGATOR_FACTORIES[factory]) return;

    let variable: string | null = null;
    let destructured: NavigatorDeclaration['destructured'] = null;
    if (ts.isIdentifier(node.name)) {
      variable = node.name.text;
    } else if (ts.isObjectBindingPattern(node.name)) {
      const elements = node.name.elements;
      const local = (property: string) => {
        const element = elements.find((entry) => {
          const key = entry.propertyName ?? entry.name;
          return ts.isIdentifier(key) && key.text === property;
        });
        return element && ts.isIdentifier(element.name) ? element.name.text : null;
      };
      destructured = { navigator: local('Navigator'), screen: local('Screen'), group: local('Group') };
      variable = destructured.navigator ?? destructured.screen;
    }
    if (!variable) return;

    const typeArgument = node.initializer.typeArguments?.[0];
    const config = node.initializer.arguments.find(ts.isObjectLiteralExpression);
    const screens = config ? findProperty(config, 'screens') : undefined;
    const staticRoutes: DetectedRoute[] = [];
    if (screens && ts.isObjectLiteralExpression(screens.initializer)) {
      for (const property of screens.initializer.properties) {
        const name = property.name ? propertyName(property.name as ts.PropertyName) : null;
        if (!name) continue;
        const component = ts.isPropertyAssignment(property) && ts.isIdentifier(property.initializer)
          ? property.initializer.text
          : ts.isShorthandPropertyAssignment(property) ? property.name.text : null;
        staticRoutes.push({ name, component });
      }
    }

    declarations.set(variable, {
      factory,
      paramListType: typeArgument && ts.isTypeReferenceNode(typeArgument) && ts.isIdentifier(typeArgument.typeName)
        ? typeArgument.typeName.text
        : null,
      isStatic: Boolean(screens),
      staticRoutes,
      destructured,
    });
  });

  return declarations;
}

export function navigatorDeclarations(content: string, fileName: string): Map<string, NavigatorDeclaration> {
  return declarationsIn(parseSource(content, fileName));
}

/** The screen whose children render this element, when there is one in the same file. */
function renderingScreen(node: ts.Node, file: ts.SourceFile, roleOf: RoleOf): { variable: string; route: string } | null {
  for (let current = node.parent; current; current = current.parent) {
    if (!ts.isJsxElement(current)) continue;
    const role = roleOf(current.openingElement.tagName.getText(file));
    if (role?.role !== 'Screen') continue;
    const route = jsxStringAttribute(current.openingElement, 'name');
    return route ? { variable: role.variable, route } : null;
  }
  return null;
}

/**
 * Every navigator the file builds or renders, in source order.
 *
 * Read from the source rather than from armemon.config: the config records what was
 * asked for at init, the file records what the app has now. `resolveImported` lets a
 * caller that knows the other files classify `<Tab.Navigator>` when `Tab` is imported.
 */
export function detectNavigators(
  content: string,
  fileName = 'RootNavigator.tsx',
  resolveImported?: (binding: ImportBinding) => NavigatorDeclaration | null,
): DetectedNavigator[] {
  const file = parseSource(content, fileName);
  const declarations = declarationsIn(file);
  const roleOf = tagRoles(declarations);
  const bindings = importBindings(file);
  const found = new Map<string, DetectedNavigator>();

  const entryFor = (variable: string): DetectedNavigator | undefined => {
    const existing = found.get(variable);
    if (existing) return existing;

    let declaration = declarations.get(variable);
    const declaredHere = Boolean(declaration);
    if (!declaration && resolveImported) {
      const binding = bindings.find((entry) => entry.local === variable);
      declaration = (binding && resolveImported(binding)) || undefined;
    }
    const factory = declaration && NAVIGATOR_FACTORIES[declaration.factory];
    if (!declaration || !factory) return undefined;

    const entry: DetectedNavigator = {
      variable,
      ...tagsFor(variable, declaredHere ? declaration : undefined),
      kind: factory.kind,
      factory: declaration.factory,
      declaredHere,
      paramListType: declaration.paramListType,
      isStatic: declaration.isStatic,
      host: null,
      hostExport: null,
      initialRouteName: null,
      routes: declaredHere ? [...declaration.staticRoutes] : [],
      elements: 0,
      renderedBy: null,
    };
    found.set(variable, entry);
    return entry;
  };

  for (const variable of declarations.keys()) entryFor(variable);

  walk(file, (node) => {
    if (!ts.isJsxElement(node) && !ts.isJsxSelfClosingElement(node)) return;
    const opening = jsxOpening(node);
    const role = roleOf(opening.tagName.getText(file));
    if (!role || role.role === 'Group') return;
    const entry = entryFor(role.variable);
    if (!entry) return;

    if (role.role === 'Navigator') {
      entry.elements += 1;
      if (entry.elements === 1) {
        const host = hostOf(node, file);
        entry.host = host.name;
        entry.hostExport = host.exported;
        entry.initialRouteName = jsxStringAttribute(opening, 'initialRouteName');
        entry.renderedBy = renderingScreen(node, file, roleOf);
      }
      return;
    }

    const name = jsxStringAttribute(opening, 'name');
    if (name === null) return;
    entry.routes.push({
      name,
      component: jsxIdentifierAttribute(opening, 'component') ?? (ts.isJsxElement(node) ? childComponentOf(node) : null),
    });
  });

  return [...found.values()];
}

function initialRouteEdit(
  file: ts.SourceFile,
  opening: ts.JsxOpeningLikeElement,
  routeName: string,
  navigatorTag: string,
  jsxQuote: string,
): TextEdit | null | string {
  const attribute = jsxAttribute(opening, 'initialRouteName');
  if (!attribute) {
    const at = opening.tagName.getEnd();
    return { start: at, end: at, text: ` initialRouteName=${jsxQuote}${routeName}${jsxQuote}` };
  }
  const literal = jsxStringLiteralOf(attribute);
  if (!literal) return `initialRouteName on <${navigatorTag}> is computed, so armemon won't change it`;
  return literal.text === routeName ? null : literalReplacement(file, literal, routeName);
}

export interface RegisterScreenOptions {
  fileName?: string;
  componentName: string;
  routeName: string;
  importPath: string;
  navigatorVariable: string;
  /** String-valued screen options, e.g. { presentation: 'modal', title: 'Orders' }. */
  screenOptions?: Record<string, string>;
  /** Also make it the navigator's initialRouteName. */
  initial?: boolean;
}

/** On an already-registered screen: set initialRouteName and merge the options asked for. */
function updateRegistration(
  content: string,
  fileName: string,
  options: RegisterScreenOptions,
  navigatorTag: string,
  manual: string,
): PatchResult {
  const { routeName, navigatorVariable: variable } = options;
  const already = `${routeName} is already registered in <${navigatorTag}>`;
  const elementsOf = (file: ts.SourceFile, role: Role) => {
    const roleOf = tagRoles(declarationsIn(file));
    return jsxElements(file, (tag) => {
      const found = roleOf(tag);
      return found?.role === role && found.variable === variable;
    });
  };
  let next = content;

  if (options.initial) {
    const file = parseSource(next, fileName);
    const navigators = elementsOf(file, 'Navigator');
    if (navigators.length !== 1) return refused(content, `couldn't find the one <${navigatorTag}> to make ${routeName} its initial route`, manual);
    const edit = initialRouteEdit(file, jsxOpening(navigators[0]!), routeName, navigatorTag, jsxQuoteOf(file));
    if (typeof edit === 'string') return refused(content, edit, manual);
    if (edit) next = applyEdits(next, [edit]);
  }

  for (const [key, value] of Object.entries(options.screenOptions ?? {})) {
    const file = parseSource(next, fileName);
    const quote = stringQuoteOf(file);
    const screen = elementsOf(file, 'Screen').find((element) => jsxStringAttribute(jsxOpening(element), 'name') === routeName);
    if (!screen) return refused(content, `couldn't find ${routeName}'s screen to set its ${key}`, manual);
    const opening = jsxOpening(screen);
    const attribute = jsxAttribute(opening, 'options');
    if (!attribute) {
      const at = opening.attributes.getEnd();
      next = applyEdits(next, [{ start: at, end: at, text: ` options={{ ${key}: ${quoteString(value, quote)} }}` }]);
      continue;
    }
    const initializer = attribute.initializer;
    const object = initializer && ts.isJsxExpression(initializer) && initializer.expression && ts.isObjectLiteralExpression(initializer.expression)
      ? initializer.expression
      : null;
    if (!object) return refused(content, `${routeName}'s options are computed, so armemon won't set its ${key}`, `${key}: ${quoteString(value, "'")},   // in ${routeName}'s options`);
    const property = findProperty(object, key);
    if (!property) {
      next = applyEdits(next, propertyInsertion(next, file, object, key, quoteString(value, quote)));
    } else if (!isStringy(property.initializer)) {
      return refused(content, `${routeName}'s ${key} option is computed, so armemon won't change it`, `${key}: ${quoteString(value, "'")},`);
    } else if (property.initializer.text !== value) {
      next = applyEdits(next, [literalReplacement(file, property.initializer, value)]);
    }
  }

  return checked(content, next, fileName, manual, already);
}

/**
 * Adds `<Var.Screen name=… component=… />` after the navigator's last screen, and the
 * component's import after the last import. On a screen that's already there with the
 * same component, applies `initial` and `screenOptions` instead.
 *
 * Keyed by the navigator's variable, which is what makes a stack-with-tabs file
 * unambiguous: `<Tab.Screen>` and `<Stack.Screen>` are different tags.
 */
export function registerScreenInNavigator(content: string, options: RegisterScreenOptions): PatchResult {
  const fileName = options.fileName ?? 'RootNavigator.tsx';
  const { componentName, routeName, importPath, navigatorVariable: variable } = options;
  const label = path.basename(fileName);
  const file = parseSource(content, fileName);
  const declarations = declarationsIn(file);
  const roleOf = tagRoles(declarations);
  const { navigatorTag, screenTag } = tagsFor(variable, declarations.get(variable));
  const jsxQuote = jsxQuoteOf(file);
  const quote = stringQuoteOf(file);

  const screenOptions = Object.entries(options.screenOptions ?? {});
  const optionsText = screenOptions.length > 0
    ? ` options={{ ${screenOptions.map(([key, value]) => `${key}: ${quoteString(value, quote)}`).join(', ')} }}`
    : '';
  const screenLine = `<${screenTag} name=${jsxQuote}${routeName}${jsxQuote} component={${componentName}}${optionsText} />`;
  const manual = `import ${componentName} from '${importPath}';\n${screenLine}`;

  const broken = brokenReason(content, fileName);
  if (broken) return refused(content, broken, manual);

  const byRole = (role: Role, owner?: string) =>
    jsxElements(file, (tag) => {
      const found = roleOf(tag);
      return found?.role === role && (owner === undefined || found.variable === owner);
    });

  const existing = byRole('Screen').find((screen) => jsxStringAttribute(jsxOpening(screen), 'name') === routeName);
  if (existing) {
    const owner = roleOf(jsxTag(existing))!.variable;
    const component = jsxIdentifierAttribute(jsxOpening(existing), 'component');
    if (owner !== variable || (component !== null && component !== componentName)) {
      return refused(
        content,
        `"${routeName}" is already a route in <${tagsFor(owner, declarations.get(owner)).navigatorTag}>${component ? `, rendering ${component}` : ''}`,
        undefined,
        true,
      );
    }
    return updateRegistration(content, fileName, options, navigatorTag, manual);
  }

  const navigators = byRole('Navigator', variable);
  const navigator = navigators[0];
  if (!navigator) return refused(content, `couldn't find <${navigatorTag}> in ${label}`, manual);
  if (navigators.length > 1) {
    return refused(content, `${label} renders <${navigatorTag}> ${navigators.length} times, so which one is ambiguous`, manual);
  }
  if (!ts.isJsxElement(navigator)) {
    return refused(content, `<${navigatorTag} /> is self-closing, so it has no screens to add to`, manual);
  }

  const edits: TextEdit[] = [];
  // Whitespace and {/* comments */} don't count: a navigator holding only those is empty.
  const children = navigator.children.filter((child) =>
    !(ts.isJsxText(child) && child.containsOnlyTriviaWhiteSpaces) && !(ts.isJsxExpression(child) && !child.expression));
  const direct = children.filter((child): child is JsxLike => {
    if (!ts.isJsxElement(child) && !ts.isJsxSelfClosingElement(child)) return false;
    const found = roleOf(jsxTag(child));
    return found?.role === 'Screen' && found.variable === variable;
  });
  const lastScreen = direct[direct.length - 1];

  if (lastScreen) {
    edits.push(lineAfter(content, lastScreen.getEnd(), indentAt(content, lastScreen.getStart(file)), screenLine));
  } else if (children.length > 0) {
    return refused(
      content,
      `the screens in <${navigatorTag}> sit inside groups or conditions, so where "${routeName}" belongs is your call`,
      manual,
    );
  } else {
    edits.push(blockInsertion(content, navigator.openingElement.getEnd(), navigator.closingElement.getStart(file), screenLine));
  }

  if (options.initial) {
    const edit = initialRouteEdit(file, navigator.openingElement, routeName, navigatorTag, jsxQuote);
    if (typeof edit === 'string') return refused(content, edit, manual);
    if (edit) edits.push(edit);
  }

  const binding = importBindings(file).find((entry) => entry.local === componentName);
  if (binding) {
    if (!samePathSpec(binding.module, importPath)) {
      return refused(content, `${label} already imports a different ${componentName} (from '${binding.module}')`, undefined, true);
    }
  } else if (topLevelDeclarationNames(file).has(componentName)) {
    return refused(content, `${label} already declares its own ${componentName}`, undefined, true);
  } else {
    edits.push(defaultImportInsertion(content, file, componentName, importPath));
  }

  return finish(content, edits, fileName, manual);
}

export interface UnregisterScreenOptions {
  fileName?: string;
  routeName: string;
  /** Remove initialRouteName when it names this route, rather than refusing. */
  dropInitialRoute?: boolean;
}

/** Removes every screen named `routeName` in the file, and imports only they used. */
export function unregisterScreenFromNavigator(content: string, options: UnregisterScreenOptions): PatchResult {
  const fileName = options.fileName ?? 'RootNavigator.tsx';
  const { routeName } = options;
  const label = path.basename(fileName);
  const file = parseSource(content, fileName);
  const manual = `Remove the "${routeName}" screen and its import from ${label}.`;

  const broken = brokenReason(content, fileName);
  if (broken) return refused(content, broken, manual);

  const declarations = declarationsIn(file);
  const roleOf = tagRoles(declarations);
  const screens = jsxElements(file, (tag) => roleOf(tag)?.role === 'Screen')
    .filter((screen) => jsxStringAttribute(jsxOpening(screen), 'name') === routeName);
  if (screens.length === 0) return done(content, `${routeName} isn't registered in ${label}`);

  const edits: TextEdit[] = [];
  const components = new Set<string>();

  for (const screen of screens) {
    if (!ts.isJsxElement(screen.parent) && !ts.isJsxFragment(screen.parent)) {
      return refused(content, `the "${routeName}" screen sits inside an expression, so removing it could leave the JSX broken`, manual);
    }
    edits.push(removalOf(content, screen.getStart(file), screen.getEnd()));
    const component = jsxIdentifierAttribute(jsxOpening(screen), 'component') ?? (ts.isJsxElement(screen) ? childComponentOf(screen) : null);
    if (component) components.add(component);

    const owner = roleOf(jsxTag(screen))!.variable;
    const navigatorTag = tagsFor(owner, declarations.get(owner)).navigatorTag;
    let navigator: ts.Node | undefined = screen.parent;
    while (navigator && !(ts.isJsxElement(navigator) &&
      roleOf(jsxTag(navigator))?.role === 'Navigator' && roleOf(jsxTag(navigator))?.variable === owner)) {
      navigator = navigator.parent;
    }
    if (navigator && ts.isJsxElement(navigator)) {
      const attribute = jsxAttribute(navigator.openingElement, 'initialRouteName');
      if (attribute && jsxStringLiteralOf(attribute)?.text === routeName) {
        if (!options.dropInitialRoute) {
          return refused(content, `"${routeName}" is the initialRouteName of <${navigatorTag}>`, manual, true);
        }
        edits.push({ start: attribute.pos, end: attribute.end, text: '' });
      }
    }
  }

  let next = applyEdits(content, edits);
  const reparsed = parseSource(next, fileName);
  const importEdits = [...components]
    .map((component) => unusedImportRemoval(next, reparsed, component))
    .filter((edit): edit is TextEdit => edit !== null);
  next = applyEdits(next, importEdits);

  const errors = sourceSyntaxErrors(next, fileName);
  if (errors.length > 0) return refused(content, `removing it would leave ${label} unparsable (${errors[0]})`, manual);
  return { content: next, changed: true };
}

export interface RenameScreenOptions {
  fileName?: string;
  from: string;
  to: string;
  fromComponent: string;
  toComponent: string;
}

/**
 * Renames the route on its screens and initialRouteName, and the component's local
 * name everywhere it is used. The import's module path is a route reference, and is
 * rewritten by routeReferences with every other file's.
 */
export function renameScreenInNavigator(content: string, options: RenameScreenOptions): PatchResult {
  const fileName = options.fileName ?? 'RootNavigator.tsx';
  const { from, to, fromComponent, toComponent } = options;
  const label = path.basename(fileName);
  const file = parseSource(content, fileName);
  const manual = `Rename name="${from}" to name="${to}" and ${fromComponent} to ${toComponent} in ${label}.`;

  const broken = brokenReason(content, fileName);
  if (broken) return refused(content, broken, manual);

  const roleOf = tagRoles(declarationsIn(file));
  const screens = jsxElements(file, (tag) => roleOf(tag)?.role === 'Screen');
  const renamed = screens.filter((screen) => jsxStringAttribute(jsxOpening(screen), 'name') === from);
  if (renamed.length === 0) {
    return done(content, screens.some((screen) => jsxStringAttribute(jsxOpening(screen), 'name') === to)
      ? `${to} is already registered in ${label}`
      : `${from} isn't registered in ${label}`);
  }

  const edits: TextEdit[] = [];
  for (const screen of renamed) {
    const literal = jsxStringLiteralOf(jsxAttribute(jsxOpening(screen), 'name'));
    if (literal) edits.push(literalReplacement(file, literal, to));
  }
  for (const navigator of jsxElements(file, (tag) => roleOf(tag)?.role === 'Navigator')) {
    const literal = jsxStringLiteralOf(jsxAttribute(jsxOpening(navigator), 'initialRouteName'));
    if (literal?.text === from) edits.push(literalReplacement(file, literal, to));
  }
  if (fromComponent !== toComponent) {
    if (topLevelDeclarationNames(file).has(toComponent) || importBindings(file).some((entry) => entry.local === toComponent)) {
      return refused(content, `${label} already has something called ${toComponent}`, manual, true);
    }
    edits.push(...identifierRenames(file, fromComponent, toComponent));
  }

  return finish(content, edits, fileName, manual);
}

interface ParamListBlock {
  members: ts.NodeArray<ts.TypeElement>;
  open: number;
  close: number;
}

function findParamList(file: ts.SourceFile, typeName: string): ParamListBlock | string | null {
  for (const statement of file.statements) {
    if (ts.isTypeAliasDeclaration(statement) && statement.name.text === typeName) {
      if (!ts.isTypeLiteralNode(statement.type)) return `${typeName} isn't a plain object type, so armemon won't edit it`;
      return { members: statement.type.members, open: statement.type.members.pos - 1, close: statement.type.getEnd() - 1 };
    }
    if (ts.isInterfaceDeclaration(statement) && statement.name.text === typeName) {
      return { members: statement.members, open: statement.members.pos - 1, close: statement.getEnd() - 1 };
    }
  }
  return null;
}

const memberName = (member: ts.TypeElement): string | null =>
  ts.isPropertySignature(member) ? propertyName(member.name) : null;

export interface ParamListOptions {
  fileName?: string;
  routeName: string;
  typeName: string;
  /** The route's params type. `undefined` — the default — means it takes none. */
  paramsType?: string;
  /** When the route is already listed with another type, replace it with `paramsType`. */
  replaceType?: boolean;
}

/** Adds `Route: undefined;` to a param list, in its separator style. */
export function addRouteToParamList(content: string, options: ParamListOptions): PatchResult {
  const fileName = options.fileName ?? 'types.ts';
  const { routeName, typeName } = options;
  const paramsType = options.paramsType ?? 'undefined';
  const memberText = `${keyText(routeName, "'")}: ${paramsType}`;
  const manual = `${memberText};   // in ${typeName}`;

  const broken = brokenReason(content, fileName);
  if (broken) return refused(content, broken, manual);

  const file = parseSource(content, fileName);
  const block = findParamList(file, typeName);
  if (block === null) return refused(content, `no ${typeName} in ${path.basename(fileName)}`, manual);
  if (typeof block === 'string') return refused(content, block, manual);

  const existing = block.members.find((member) => memberName(member) === routeName);
  if (existing) {
    const type = ts.isPropertySignature(existing) ? existing.type : undefined;
    if (!options.replaceType || !type || type.getText(file) === paramsType) {
      return done(content, `${routeName} is already in ${typeName}`);
    }
    return finish(content, [{ start: type.getStart(file), end: type.getEnd(), text: paramsType }], fileName, manual);
  }

  const last = block.members[block.members.length - 1];
  if (!last) return finish(content, [blockInsertion(content, block.open + 1, block.close, `${memberText};`)], fileName, manual);

  const separator = /[;,]$/.exec(last.getText(file).trimEnd())?.[0] ?? '';
  if (!content.slice(block.open, block.close).includes('\n')) {
    const text = separator ? ` ${memberText}${separator}` : `; ${memberText}`;
    return finish(content, [{ start: last.getEnd(), end: last.getEnd(), text }], fileName, manual);
  }
  return finish(content, [lineAfter(content, last.getEnd(), indentAt(content, last.getStart(file)), `${memberText}${separator}`)], fileName, manual);
}

export function removeRouteFromParamList(content: string, options: Omit<ParamListOptions, 'paramsType' | 'replaceType'>): PatchResult {
  const fileName = options.fileName ?? 'types.ts';
  const { routeName, typeName } = options;
  const manual = `Remove ${routeName} from ${typeName}.`;

  const broken = brokenReason(content, fileName);
  if (broken) return refused(content, broken, manual);

  const file = parseSource(content, fileName);
  const block = findParamList(file, typeName);
  if (block === null || typeof block === 'string') return done(content, `no ${typeName} to remove ${routeName} from`);
  const member = block.members.find((entry) => memberName(entry) === routeName);
  if (!member) return done(content, `${routeName} isn't in ${typeName}`);
  return finish(content, [removalOf(content, member.getStart(file), member.getEnd())], fileName, manual);
}

export function renameRouteInParamList(
  content: string,
  options: { fileName?: string; from: string; to: string; typeName: string },
): PatchResult {
  const fileName = options.fileName ?? 'types.ts';
  const { from, to, typeName } = options;
  const manual = `Rename ${from} to ${to} in ${typeName}.`;

  const broken = brokenReason(content, fileName);
  if (broken) return refused(content, broken, manual);

  const file = parseSource(content, fileName);
  const block = findParamList(file, typeName);
  if (block === null || typeof block === 'string') return done(content, `no ${typeName} to rename ${from} in`);
  if (block.members.some((entry) => memberName(entry) === to)) return done(content, `${to} is already in ${typeName}`);
  const member = block.members.find((entry) => memberName(entry) === from);
  if (!member || !ts.isPropertySignature(member)) return done(content, `${from} isn't in ${typeName}`);
  return finish(content, [{ start: member.name.getStart(file), end: member.name.getEnd(), text: keyText(to, "'") }], fileName, manual);
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
}

/** The `screens` object of the linking config — preferring the one under `linking`. */
function linkingScreens(file: ts.SourceFile): ts.ObjectLiteralExpression | null {
  const candidates: Array<{ screens: ts.ObjectLiteralExpression; inLinking: boolean }> = [];
  walk(file, (node) => {
    if (!ts.isPropertyAssignment(node) || propertyName(node.name) !== 'config') return;
    const config = unwrapExpression(node.initializer);
    if (!ts.isObjectLiteralExpression(config)) return;
    const screens = findProperty(config, 'screens');
    if (!screens || !ts.isObjectLiteralExpression(screens.initializer)) return;
    let inLinking = false;
    for (let parent: ts.Node | undefined = node.parent; parent; parent = parent.parent) {
      if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name) && parent.name.text === 'linking') inLinking = true;
    }
    candidates.push({ screens: screens.initializer, inLinking });
  });
  return (candidates.find((candidate) => candidate.inLinking) ?? candidates[0])?.screens ?? null;
}

/** When there's no config.screens yet: the `linking` object, and its `config` if it has one. */
function linkingContainers(file: ts.SourceFile): { linking: ts.ObjectLiteralExpression | null; config: ts.ObjectLiteralExpression | null } {
  const found: { linking: ts.ObjectLiteralExpression | null } = { linking: null };
  walk(file, (node) => {
    if (found.linking || !ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || node.name.text !== 'linking' || !node.initializer) return;
    const initializer = unwrapExpression(node.initializer);
    if (ts.isObjectLiteralExpression(initializer)) found.linking = initializer;
  });
  const configProperty = found.linking ? findProperty(found.linking, 'config') : undefined;
  const config = configProperty ? unwrapExpression(configProperty.initializer) : null;
  return { linking: found.linking, config: config && ts.isObjectLiteralExpression(config) ? config : null };
}

function findLinkingEntry(screens: ts.ObjectLiteralExpression, routeName: string): ts.PropertyAssignment | null {
  for (const property of screens.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    if (propertyName(property.name) === routeName) return property;
    if (ts.isObjectLiteralExpression(property.initializer)) {
      const nested = findProperty(property.initializer, 'screens');
      if (nested && ts.isObjectLiteralExpression(nested.initializer)) {
        const found = findLinkingEntry(nested.initializer, routeName);
        if (found) return found;
      }
    }
  }
  return null;
}

function nestedScreens(rest: string[], routeName: string, value: SourceValue): { screens: SourceValue } {
  const [head, ...tail] = rest;
  return { screens: head === undefined ? { [routeName]: value } : { [head]: nestedScreens(tail, routeName, value) } };
}

export interface LinkingRouteOptions {
  fileName?: string;
  routeName: string;
  path: string;
  /** Param name → parser code, e.g. { id: 'Number' }. Switches the entry to its full form. */
  parse?: Record<string, string>;
  /**
   * Route names from the root navigator down to the navigator this route is in; empty
   * for the root. React Navigation resolves a flat entry for a tab screen to a root
   * route the root stack doesn't have, so the link would open nothing.
   */
  nesting?: string[];
  /** Raw code for the entry's value, used as is — how an existing entry is moved. */
  value?: string;
  /**
   * For a route that already has an entry: `path` sets its path, `parsers` sets the
   * parsers in `parse` and removes those named in `clearParsers`. Without it an
   * existing entry is left exactly as it is.
   */
  update?: { path?: boolean; parsers?: boolean };
  clearParsers?: string[];
}

function updateLinkingEntry(content: string, options: LinkingRouteOptions, fileName: string, manual: string): PatchResult {
  const { routeName } = options;
  const update = options.update ?? {};
  const parse = options.parse && Object.keys(options.parse).length > 0 ? options.parse : undefined;
  const locate = (text: string) => {
    const file = parseSource(text, fileName);
    const screens = linkingScreens(file);
    return { file, entry: screens ? findLinkingEntry(screens, routeName) : null };
  };
  const upToDate = `${routeName}'s deep link is already up to date`;

  let next = content;
  let { file, entry } = locate(next);
  if (!entry) return done(content, `${routeName} already has a linking entry`);
  const quote = stringQuoteOf(file);

  if (isStringy(entry.initializer)) {
    const literal = entry.initializer;
    const nextPath = update.path ? options.path : literal.text;
    if (update.parsers && parse) {
      const container = entry.parent as ts.ObjectLiteralExpression;
      const rendered = renderValue(
        { path: quoteString(nextPath, quote), parse },
        {
          indent: indentAt(content, entry.getStart(file)),
          unit: indentUnitOf(content),
          eol: eolOf(content),
          inline: !content.slice(container.getStart(file), container.getEnd()).includes('\n'),
          trailingComma: container.properties.hasTrailingComma,
          quote,
        },
      );
      return finish(content, [{ start: literal.getStart(file), end: literal.getEnd(), text: rendered }], fileName, manual);
    }
    if (nextPath === literal.text) return done(content, upToDate);
    return finish(content, [literalReplacement(file, literal, nextPath)], fileName, manual);
  }

  if (!ts.isObjectLiteralExpression(entry.initializer)) {
    return refused(content, `the linking entry for ${routeName} isn't an object armemon can update`, manual);
  }

  if (update.path) {
    const object = entry.initializer;
    const pathProperty = findProperty(object, 'path');
    if (!pathProperty) {
      next = applyEdits(next, propertyInsertion(next, file, object, 'path', quoteString(options.path, quote)));
    } else if (!isStringy(pathProperty.initializer)) {
      return refused(content, `${routeName}'s deep-link path is computed, so armemon won't change it`, manual);
    } else if (pathProperty.initializer.text !== options.path) {
      next = applyEdits(next, [literalReplacement(file, pathProperty.initializer, options.path)]);
    }
  }

  if (update.parsers) {
    for (const [key, code] of Object.entries(parse ?? {})) {
      ({ file, entry } = locate(next));
      const object = entry!.initializer as ts.ObjectLiteralExpression;
      const parseProperty = findProperty(object, 'parse');
      if (!parseProperty) {
        next = applyEdits(next, propertyInsertion(next, file, object, 'parse', { [key]: code }));
        continue;
      }
      if (!ts.isObjectLiteralExpression(parseProperty.initializer)) {
        return refused(content, `${routeName}'s parse option isn't an object armemon can update`, manual);
      }
      const parser = findProperty(parseProperty.initializer, key);
      if (!parser) {
        next = applyEdits(next, propertyInsertion(next, file, parseProperty.initializer, key, code));
      } else if (parser.initializer.getText(file) !== code) {
        next = applyEdits(next, [{ start: parser.initializer.getStart(file), end: parser.initializer.getEnd(), text: code }]);
      }
    }
    for (const key of options.clearParsers ?? []) {
      ({ file, entry } = locate(next));
      const parseProperty = findProperty(entry!.initializer as ts.ObjectLiteralExpression, 'parse');
      if (!parseProperty || !ts.isObjectLiteralExpression(parseProperty.initializer)) continue;
      const parser = findProperty(parseProperty.initializer, key);
      if (!parser) continue;
      const target = parseProperty.initializer.properties.length === 1 ? parseProperty : parser;
      next = applyEdits(next, [removalOf(next, target.getStart(file), target.getEnd(), { trailingComma: true })]);
    }
  }

  return checked(content, next, fileName, manual, upToDate);
}

/** Adds a path to the linking config, nested under the navigators it lives in. */
export function addLinkingRoute(content: string, options: LinkingRouteOptions): PatchResult {
  const fileName = options.fileName ?? 'navigation.config.ts';
  const { routeName } = options;
  const nesting = options.nesting ?? [];
  const label = path.basename(fileName);
  const file = parseSource(content, fileName);
  const quote = stringQuoteOf(file);
  const parse = options.parse && Object.keys(options.parse).length > 0 ? options.parse : undefined;
  const pathText = quoteString(options.path, quote);
  const value: SourceValue = options.value ?? (parse ? { path: pathText, parse } : pathText);
  const where = nesting.length > 0 ? `config.screens → ${nesting.join(' → screens → ')} → screens` : 'config.screens';
  const manual = `${routeName}: ${renderValue(value, { indent: '', unit: '  ', eol: '\n', inline: true, trailingComma: false, quote })},   // in ${where}`;

  const broken = brokenReason(content, fileName);
  if (broken) return refused(content, broken, manual);

  const screens = linkingScreens(file);
  if (!screens) {
    const { linking, config } = linkingContainers(file);
    const inner = nestedScreens(nesting, routeName, value);
    if (config) return finish(content, propertyInsertion(content, file, config, 'screens', inner.screens), fileName, manual);
    if (linking) return finish(content, propertyInsertion(content, file, linking, 'config', inner), fileName, manual);
    return refused(content, `no linking object in ${label}`, manual);
  }

  if (findLinkingEntry(screens, routeName)) {
    return options.update ? updateLinkingEntry(content, options, fileName, manual) : done(content, `${routeName} already has a linking entry`);
  }

  let container = screens;
  for (let index = 0; index < nesting.length; index += 1) {
    const parent = nesting[index]!;
    const inner = nestedScreens(nesting.slice(index + 1), routeName, value);
    const property = findProperty(container, parent);
    if (!property) return finish(content, propertyInsertion(content, file, container, parent, inner), fileName, manual);

    const initializer = property.initializer;
    if (isStringy(initializer)) {
      const rendered = renderValue(
        { path: initializer.getText(file), ...inner },
        {
          indent: indentAt(content, property.getStart(file)),
          unit: indentUnitOf(content),
          eol: eolOf(content),
          inline: false,
          trailingComma: container.properties.hasTrailingComma,
          quote,
        },
      );
      return finish(content, [{ start: initializer.getStart(file), end: initializer.getEnd(), text: rendered }], fileName, manual);
    }
    if (!ts.isObjectLiteralExpression(initializer)) {
      return refused(content, `the linking entry for ${parent} isn't an object armemon can add to`, manual);
    }
    const nested = findProperty(initializer, 'screens');
    if (!nested) return finish(content, propertyInsertion(content, file, initializer, 'screens', inner.screens), fileName, manual);
    if (!ts.isObjectLiteralExpression(nested.initializer)) {
      return refused(content, `${parent}.screens in the linking config isn't an object literal`, manual);
    }
    container = nested.initializer;
  }

  return finish(content, propertyInsertion(content, file, container, routeName, value), fileName, manual);
}

/**
 * Moves flat, root-level entries for these routes under `nesting`. Apps scaffolded
 * before init nested its tab links have every tab's link at the root, where React
 * Navigation never finds them; moving them is what makes them work.
 */
export function nestLinkingRoutes(content: string, options: { fileName?: string; routes: string[]; nesting: string[] }): PatchResult {
  const fileName = options.fileName ?? 'navigation.config.ts';
  const manual = `Move ${options.routes.join(', ')} under ${options.nesting.join(' → ')} in the linking config.`;
  if (options.nesting.length === 0) return done(content, 'nothing to nest under');

  const broken = brokenReason(content, fileName);
  if (broken) return refused(content, broken, manual);

  const file = parseSource(content, fileName);
  const screens = linkingScreens(file);
  const flat = screens
    ? options.routes
      .map((route) => findProperty(screens, route))
      .filter((property): property is ts.PropertyAssignment => property !== undefined && property.name !== undefined)
    : [];
  if (flat.length === 0) return done(content, 'no flat links to move');

  const moved = flat.map((property) => {
    // Written relative to its key, so it lines up wherever it lands.
    const keyIndent = indentAt(content, property.getStart(file));
    const value = property.initializer
      .getText(file)
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line, index) => (index > 0 && line.startsWith(keyIndent) ? line.slice(keyIndent.length) : line))
      .join('\n');
    return { route: propertyName(property.name)!, value };
  });
  let next = applyEdits(content, flat.map((property) => removalOf(content, property.getStart(file), property.getEnd(), { trailingComma: true })));
  for (const { route, value } of moved) {
    const result = addLinkingRoute(next, { fileName, routeName: route, path: '', value, nesting: options.nesting });
    // Already linked where it belongs: the flat copy was only a stale duplicate.
    if (!result.changed && !result.already) return refused(content, result.reason ?? `couldn't move ${route}'s link`, manual);
    if (result.changed) next = result.content;
  }

  const result = checked(content, next, fileName, manual);
  return result.changed ? { ...result, names: moved.map((entry) => entry.route) } : result;
}

export function removeLinkingRoute(content: string, options: { fileName?: string; routeName: string }): PatchResult {
  const fileName = options.fileName ?? 'navigation.config.ts';
  const manual = `Remove ${options.routeName} from the linking config's screens.`;

  const broken = brokenReason(content, fileName);
  if (broken) return refused(content, broken, manual);

  const file = parseSource(content, fileName);
  const screens = linkingScreens(file);
  const entry = screens ? findLinkingEntry(screens, options.routeName) : null;
  if (!entry) return done(content, `${options.routeName} has no linking entry`);
  return finish(content, [removalOf(content, entry.getStart(file), entry.getEnd(), { trailingComma: true })], fileName, manual);
}

/** The path a route's linking entry maps to, whether written short or in full form. */
export interface WireLinkingOptions {
  fileName?: string;
  /** How the glue reaches the linking config. */
  from?: string;
}

/**
 * Makes the navigation glue actually pass its linking config to NavigationContainer.
 *
 * A config file that nothing imports is the quietest possible failure: the file looks
 * right, every path in it is correct, and React Navigation never sees it — so on web
 * every screen renders at the bare origin no matter what you navigate to. That is the
 * state an app is left in when linking was declined at scaffold time, and the state
 * this repairs.
 */
export function wireLinkingIntoGlue(content: string, options: WireLinkingOptions = {}): PatchResult {
  const fileName = options.fileName ?? 'index.ts';
  const from = options.from ?? './navigation.config';
  const manual = `import { linking } from '${from}'; and pass { linking } to configureNavigationPlugin().`;

  const broken = brokenReason(content, fileName);
  if (broken) return refused(content, broken, manual);

  const file = parseSource(content, fileName);

  let call: ts.CallExpression | null = null;
  walk(file, (node) => {
    if (call) return;
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'configureNavigationPlugin'
    ) {
      call = node;
    }
  });
  if (call === null) {
    return refused(content, `no configureNavigationPlugin() call in ${path.basename(fileName)}`, manual);
  }
  const target = call as ts.CallExpression;

  const edits: TextEdit[] = [];
  const importEdit = namedImportInsertion(content, file, 'linking', from);
  if (importEdit) edits.push(importEdit);

  const first = target.arguments[0];
  if (!first) {
    // configureNavigationPlugin()  ->  configureNavigationPlugin({ linking })
    const beforeCloseParen = target.getEnd() - 1;
    edits.push({ start: beforeCloseParen, end: beforeCloseParen, text: '{ linking }' });
  } else if (ts.isObjectLiteralExpression(first)) {
    if (findProperty(first, 'linking')) {
      return edits.length > 0
        ? finish(content, edits, fileName, manual)
        : done(content, 'the navigation glue already passes linking');
    }
    edits.push(...propertyInsertion(content, file, first, 'linking', 'linking'));
  } else {
    return refused(
      content,
      "configureNavigationPlugin() is called with something armemon can't add to",
      manual,
    );
  }

  return finish(content, edits, fileName, manual);
}

export interface LinkingRoute {
  /** The route name, as it appears in config.screens. */
  routeName: string;
  /** The path it maps to, or null for an entry that only nests other screens. */
  path: string | null;
  /** Route names from the root down to the navigator this entry sits in. */
  nesting: string[];
}

/**
 * Every deep link the config declares, nested ones included.
 *
 * The nesting is reported rather than flattened away because it is the thing that
 * makes a link work or not: React Navigation resolves a flat entry for a tab screen
 * to a root route the root stack doesn't have, so the link opens nothing. Anything
 * listing these has to be able to show where each one actually sits.
 */
export function linkingRoutes(content: string, fileName = 'navigation.config.ts'): LinkingRoute[] {
  const file = parseSource(content, fileName);
  const screens = linkingScreens(file);
  if (!screens) return [];

  const found: LinkingRoute[] = [];

  const visit = (object: ts.ObjectLiteralExpression, nesting: string[]): void => {
    for (const property of object.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const routeName = propertyName(property.name);
      if (routeName === null) continue;

      const initializer = property.initializer;
      if (isStringy(initializer)) {
        found.push({ routeName, path: initializer.text, nesting });
        continue;
      }

      if (ts.isObjectLiteralExpression(initializer)) {
        const pathProperty = findProperty(initializer, 'path')?.initializer;
        found.push({
          routeName,
          path: isStringy(pathProperty) ? pathProperty.text : null,
          nesting,
        });

        const nested = findProperty(initializer, 'screens')?.initializer;
        if (nested && ts.isObjectLiteralExpression(nested)) visit(nested, [...nesting, routeName]);
      }
    }
  };

  visit(screens, []);
  return found;
}

export function linkingPathOf(content: string, options: { fileName?: string; routeName: string }): string | null {
  const file = parseSource(content, options.fileName ?? 'navigation.config.ts');
  const screens = linkingScreens(file);
  const entry = screens ? findLinkingEntry(screens, options.routeName) : null;
  if (!entry) return null;
  const initializer = entry.initializer;
  if (isStringy(initializer)) return initializer.text;
  if (ts.isObjectLiteralExpression(initializer)) {
    const pathProperty = findProperty(initializer, 'path')?.initializer;
    if (isStringy(pathProperty)) return pathProperty.text;
  }
  return null;
}

export function renameLinkingRoute(
  content: string,
  options: { fileName?: string; from: string; to: string; path?: string },
): PatchResult {
  const fileName = options.fileName ?? 'navigation.config.ts';
  const { from, to } = options;
  const manual = `Rename ${from} to ${to} in the linking config's screens${options.path ? ` and set its path to '${options.path}'` : ''}.`;

  const broken = brokenReason(content, fileName);
  if (broken) return refused(content, broken, manual);

  const file = parseSource(content, fileName);
  const screens = linkingScreens(file);
  const entry = screens ? findLinkingEntry(screens, from) : null;
  if (!entry) return done(content, screens && findLinkingEntry(screens, to) ? `${to} already has a linking entry` : `${from} has no linking entry`);

  const edits: TextEdit[] = [{ start: entry.name.getStart(file), end: entry.name.getEnd(), text: keyText(to, stringQuoteOf(file)) }];
  if (options.path !== undefined) {
    const initializer = entry.initializer;
    const literal = isStringy(initializer)
      ? initializer
      : ts.isObjectLiteralExpression(initializer) ? findProperty(initializer, 'path')?.initializer : undefined;
    if (isStringy(literal) && literal.text !== options.path) edits.push(literalReplacement(file, literal, options.path));
  }
  return finish(content, edits, fileName, manual);
}
