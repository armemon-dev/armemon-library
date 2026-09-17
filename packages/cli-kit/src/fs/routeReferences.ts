/**
 * FILE: routeReferences.ts
 * PATH: packages/cli-kit/src/fs/routeReferences.ts
 *
 * WHAT: Finds — and for a rename, rewrites — the places in an app's source that name a
 *       route or reach into a screen's folder: navigation.navigate('Order'),
 *       { screen: 'Order' }, initialRouteName, NativeStackScreenProps<…, 'Order'>,
 *       <Link screen="Order">, and imports of ../OrderScreen.
 * WHY:  Removing a screen that is still navigated to fails at runtime in a JavaScript
 *       app and in an unrelated file in a TypeScript one; renaming one without its
 *       call sites breaks every one of them.
 *
 *       Just as important is what it must NOT touch. The first version matched any
 *       call named push or replace and any string in any generic, and a rename
 *       rewrote tags.push('Order'), text.replace('Order', …) and
 *       Exclude<Status, 'Order'>. So a call only counts when it is made on something
 *       that is navigation — navigation, props.navigation, navigationRef.current,
 *       useNavigation(), CommonActions and friends, or a bare navigate() — and a type
 *       argument only counts inside the navigation prop types. Everything else is
 *       reported as a plain mention and left alone.
 * HOW:  One walk per file over string literals and module specifiers. Pure.
 * WHEN: `armemon remove-screen` (to refuse while references remain) and
 *       `armemon rename-screen` (to rewrite them).
 *
 * EXPORTS: RouteReference, RouteReferenceKind, ReferenceTarget, RenameReferencesOptions,
 *          BLOCKING_REFERENCE_KINDS, findRouteReferences, findLinkUrlReferences,
 *          reexportsInto, removeReexports, renameRouteReferences, renameInComments,
 *          renameInScreenFile, ScreenNames
 * DEPENDS ON: node:path, typescript, ./sourceEdit
 * USED BY: packages/cli-armemon/src/flows/removeScreen.ts, renameScreen.ts
 */

import path from 'node:path';
import ts from 'typescript';
import type { PatchResult } from './navigatorPatcher.js';
import {
  type TextEdit,
  applyEdits,
  commentRanges,
  identifierRenames,
  importBindings,
  parseSource,
  propertyName,
  quoteString,
  removalOf,
  sourceSyntaxErrors,
  topLevelDeclarationNames,
  walk,
} from './sourceEdit.js';

export type RouteReferenceKind = 'navigate' | 'screen-param' | 'initial-route' | 'type' | 'screen' | 'import' | 'url' | 'mention';

/** Kinds that break when the route disappears. A bare mention might be a title. */
export const BLOCKING_REFERENCE_KINDS: ReadonlySet<RouteReferenceKind> = new Set([
  'navigate', 'screen-param', 'initial-route', 'type', 'screen', 'import',
]);

export interface RouteReference {
  kind: RouteReferenceKind;
  line: number;
  column: number;
  /** The whole source line, trimmed. */
  text: string;
  start: number;
  end: number;
}

export interface ReferenceTarget {
  routeName: string;
  /** Absolute path of the screen's folder. */
  folder: string;
  /** Recognises imports through path aliases: @/screens/OrderScreen. */
  componentName: string;
}

const NAVIGATION_METHODS = new Set(['navigate', 'push', 'replace', 'jumpTo', 'popTo', 'navigateDeprecated', 'preload', 'reset']);
const ACTION_CREATORS = new Set(['CommonActions', 'StackActions', 'TabActions', 'DrawerActions']);
const NAVIGATION_TYPES = /(ScreenProps|NavigationProp|RouteProp)$/;

/** navigation for navigation.x, props.navigation.x, navigationRef.current?.x, useNavigation().x. */
function receiverName(expression: ts.Expression): string | null {
  let target = expression;
  while (ts.isNonNullExpression(target) || ts.isParenthesizedExpression(target)) target = target.expression;
  if (ts.isPropertyAccessExpression(target)) {
    return target.name.text === 'current' ? receiverName(target.expression) : target.name.text;
  }
  if (ts.isIdentifier(target)) return target.text;
  if (ts.isCallExpression(target) && ts.isIdentifier(target.expression) && target.expression.text === 'useNavigation') {
    return 'navigation';
  }
  return null;
}

function isNavigationReceiver(name: string | null): boolean {
  if (name === null) return false;
  return /(navigation|navigator)$/i.test(name) || /^nav(igation)?Ref$|^nav$/i.test(name) || ACTION_CREATORS.has(name);
}

/** The navigation method a call is, or null: nothing else called push or replace counts. */
function navigationMethod(call: ts.CallExpression): string | null {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text === 'navigate' ? 'navigate' : null;
  if (ts.isPropertyAccessExpression(callee) && NAVIGATION_METHODS.has(callee.name.text) && isNavigationReceiver(receiverName(callee.expression))) {
    return callee.name.text;
  }
  return null;
}

function insideNavigationCall(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  for (let depth = 0; current && depth < 8; depth += 1, current = current.parent) {
    if (ts.isCallExpression(current)) return navigationMethod(current) !== null;
  }
  return false;
}

function isInside(file: string, folder: string): boolean {
  return file === folder || file.startsWith(`${folder}${path.sep}`);
}

function pointsInto(spec: string, filePath: string, target: ReferenceTarget): boolean {
  if (spec.startsWith('.')) return isInside(path.resolve(path.dirname(filePath), spec), target.folder);
  return new RegExp(`(^|/)${target.componentName}(/|$)`).test(spec);
}

function classify(node: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral): RouteReferenceKind {
  // `signedIn ? 'Home' : 'Login'`, `next ?? 'Login'`, `('Login' as const)` still pass the route.
  let argument: ts.Node = node;
  let parent = node.parent;
  while (
    (ts.isConditionalExpression(parent) && parent.condition !== argument) ||
    ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent) ||
    (ts.isBinaryExpression(parent) && parent.right === argument &&
      (parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || parent.operatorToken.kind === ts.SyntaxKind.BarBarToken))
  ) {
    argument = parent;
    parent = parent.parent;
  }

  if (ts.isCallExpression(parent) && parent.arguments[0] === argument) {
    const method = navigationMethod(parent);
    return method && method !== 'reset' ? 'navigate' : 'mention';
  }
  if (ts.isPropertyAssignment(parent) && parent.initializer === argument) {
    const key = propertyName(parent.name);
    if (key === 'initialRouteName') return 'initial-route';
    if ((key === 'screen' || key === 'name') && insideNavigationCall(parent)) return 'screen-param';
    return 'mention';
  }
  if (ts.isJsxExpression(parent)) parent = parent.parent;
  if (ts.isJsxAttribute(parent)) {
    const attribute = parent.name.getText();
    const tag = parent.parent.parent.tagName.getText();
    if (attribute === 'initialRouteName') return 'initial-route';
    if (attribute === 'name' && /(^|\.)Screen$/.test(tag)) return 'screen';
    if (attribute === 'screen' && /(^|\.)Link$/.test(tag)) return 'screen-param';
    return 'mention';
  }
  if (ts.isLiteralTypeNode(parent) && ts.isTypeReferenceNode(parent.parent)) {
    const typeName = parent.parent.typeName;
    const name = ts.isIdentifier(typeName) ? typeName.text : typeName.right.text;
    return NAVIGATION_TYPES.test(name) ? 'type' : 'mention';
  }
  return 'mention';
}

function referenceAt(content: string, file: ts.SourceFile, kind: RouteReferenceKind, node: ts.Node): RouteReference {
  const start = node.getStart(file);
  const { line, character } = file.getLineAndCharacterOfPosition(start);
  const lineStart = content.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = content.indexOf('\n', start);
  return {
    kind,
    line: line + 1,
    column: character + 1,
    text: content.slice(lineStart, lineEnd === -1 ? content.length : lineEnd).trim(),
    start,
    end: node.getEnd(),
  };
}

/**
 * Strings that open a deep link by URL — linkTo('/order'), <Link href="/order">,
 * Linking.openURL('myapp://order/42'). When a rename moves the path or a removal drops
 * it, they stop working without anything failing to compile, so they get listed.
 *
 * The path has to be where a link's path starts: the whole app path (/order), right
 * after a custom scheme (myapp://order), or right after a web host
 * (https://myapp.com/order). Inside another path — /api/order,
 * ./assets/order/icon.png — it isn't a link to this screen.
 */
export function findLinkUrlReferences(content: string, filePath: string, linkPath: string): RouteReference[] {
  const leading: string[] = [];
  for (const segment of linkPath.split('/')) {
    if (segment.startsWith(':')) break;
    leading.push(segment);
  }
  if (leading.length === 0) return [];
  const escaped = leading.join('/').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^(?:/|[A-Za-z][\\w+.-]*://(?:[^/?#]+/)?)${escaped}(?=$|[/?#])`);

  const file = parseSource(content, filePath);
  const references: RouteReference[] = [];
  walk(file, (node) => {
    if (!ts.isStringLiteral(node) && !ts.isNoSubstitutionTemplateLiteral(node) && !ts.isTemplateHead(node)) return;
    if (ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent)) return;
    if (pattern.test(node.text)) references.push(referenceAt(content, file, 'url', node));
  });
  return references;
}

export function findRouteReferences(content: string, filePath: string, target: ReferenceTarget): RouteReference[] {
  const file = parseSource(content, filePath);
  const references: RouteReference[] = [];
  const add = (kind: RouteReferenceKind, node: ts.Node) => references.push(referenceAt(content, file, kind, node));

  walk(file, (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      if (pointsInto(node.moduleSpecifier.text, filePath, target)) add('import', node.moduleSpecifier);
      return;
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteralLike(argument) && pointsInto(argument.text, filePath, target)) add('import', argument);
      return;
    }
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text === target.routeName) {
      // Module specifiers are handled above; don't count `from 'Order'` twice.
      if (ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent)) return;
      add(classify(node), node);
    }
  });

  return references;
}

/**
 * The names a file re-exports from inside the screen's folder —
 * `export { default as OrderScreen } from './OrderScreen'` — or null when it re-exports
 * everything from there (`export * from './OrderScreen'`), whose names can't be known.
 */
export function reexportsInto(content: string, filePath: string, target: ReferenceTarget): string[] | null {
  const file = parseSource(content, filePath);
  const names: string[] = [];
  for (const statement of file.statements) {
    if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (!pointsInto(statement.moduleSpecifier.text, filePath, target)) continue;
    if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) return null;
    names.push(...statement.exportClause.elements.map((element) => element.name.text));
  }
  return names;
}

/**
 * Takes these names' re-exports from inside the screen's folder out of a barrel — the
 * whole line when nothing else on it stays. A barrel line pointing at a deleted folder
 * breaks the build of everything that imports the barrel.
 */
export function removeReexports(content: string, filePath: string, target: ReferenceTarget, names: string[]): PatchResult {
  const file = parseSource(content, filePath);
  const edits: TextEdit[] = [];
  const removed: string[] = [];

  for (const statement of file.statements) {
    if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (!pointsInto(statement.moduleSpecifier.text, filePath, target)) continue;
    const clause = statement.exportClause;
    if (!clause || !ts.isNamedExports(clause)) continue;

    const kept = clause.elements.filter((element) => !names.includes(element.name.text));
    if (kept.length === clause.elements.length) continue;
    removed.push(...clause.elements.filter((element) => names.includes(element.name.text)).map((element) => element.name.text));
    edits.push(kept.length === 0
      ? removalOf(content, statement.getStart(file), statement.getEnd())
      : { start: clause.getStart(file), end: clause.getEnd(), text: `{ ${kept.map((element) => element.getText(file)).join(', ')} }` });
  }

  if (edits.length === 0) return { content, changed: false, already: true, reason: 'nothing re-exported from there' };
  const next = applyEdits(content, edits);
  const errors = sourceSyntaxErrors(next, filePath);
  if (errors.length > 0) {
    return { content, changed: false, reason: `the edit would leave ${path.basename(filePath)} unparsable (${errors[0]})` };
  }
  return { content: next, changed: true, names: removed };
}

export interface RenameReferencesOptions extends ReferenceTarget {
  to: string;
  toFolder: string;
  toComponent: string;
}

/**
 * `import { OrderScreen } from '../OrderScreen'` names an export that the rename changes,
 * so the import has to change with it: renamed along with its uses, or aliased when the
 * file already has something called the new name. A re-export keeps its public name.
 */
function namedImportRenames(file: ts.SourceFile, filePath: string, options: RenameReferencesOptions): TextEdit[] {
  const edits: TextEdit[] = [];
  for (const statement of file.statements) {
    const isImport = ts.isImportDeclaration(statement);
    const isExport = ts.isExportDeclaration(statement);
    if ((!isImport && !isExport) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (!pointsInto(statement.moduleSpecifier.text, filePath, options)) continue;

    const elements = isImport
      ? (statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings) ? statement.importClause.namedBindings.elements : [])
      : (statement.exportClause && ts.isNamedExports(statement.exportClause) ? statement.exportClause.elements : []);

    for (const element of elements) {
      const imported = element.propertyName ?? element.name;
      if (!ts.isIdentifier(imported) || imported.text !== options.componentName) continue;

      if (element.propertyName || isExport) {
        const text = element.propertyName ? options.toComponent : `${options.toComponent} as ${options.componentName}`;
        edits.push({ start: imported.getStart(file), end: imported.getEnd(), text });
      } else if (topLevelDeclarationNames(file).has(options.toComponent) || importBindings(file).some((binding) => binding.local === options.toComponent)) {
        edits.push({ start: element.name.getStart(file), end: element.name.getEnd(), text: `${options.toComponent} as ${options.componentName}` });
      } else {
        edits.push(...identifierRenames(file, options.componentName, options.toComponent, { renameImportedName: true }));
      }
    }
  }
  return edits;
}

/**
 * Rewrites every reference `findRouteReferences` can classify, and returns the plain
 * mentions it left alone so the caller can list them.
 */
export function renameRouteReferences(
  content: string,
  filePath: string,
  options: RenameReferencesOptions,
): { result: PatchResult; unhandled: RouteReference[] } {
  const references = findRouteReferences(content, filePath, options);
  const file = parseSource(content, filePath);
  const edits: TextEdit[] = [];
  const unhandled: RouteReference[] = [];

  for (const reference of references) {
    const quote = content[reference.start] ?? "'";
    if (reference.kind === 'mention') {
      unhandled.push(reference);
      continue;
    }
    if (reference.kind !== 'import') {
      edits.push({ start: reference.start, end: reference.end, text: quote === '`' ? `\`${options.to}\`` : quoteString(options.to, quote) });
      continue;
    }

    const spec = content.slice(reference.start + 1, reference.end - 1);
    let next: string;
    if (spec.startsWith('.')) {
      // A file that moves with the folder keeps its relative imports into it.
      if (isInside(filePath, options.folder)) continue;
      const resolved = path.resolve(path.dirname(filePath), spec);
      const moved = path.join(options.toFolder, path.relative(options.folder, resolved));
      next = path.relative(path.dirname(filePath), moved).split(path.sep).join('/');
      if (!next.startsWith('.')) next = `./${next}`;
    } else {
      next = spec.replace(new RegExp(`(^|/)${options.componentName}(?=/|$)`), `$1${options.toComponent}`);
    }
    if (next !== spec) edits.push({ start: reference.start, end: reference.end, text: quoteString(next, quote) });
  }

  if (!isInside(filePath, options.folder)) edits.push(...namedImportRenames(file, filePath, options));

  // Two imports of the component both rename its uses; each range is edited once.
  const unique = edits.filter((edit, index) => edits.findIndex((other) => other.start === edit.start && other.end === edit.end) === index);
  if (unique.length === 0) return { result: { content, changed: false, already: true, reason: 'no references' }, unhandled };
  const next = applyEdits(content, unique);
  const errors = sourceSyntaxErrors(next, filePath);
  if (errors.length > 0) {
    return {
      result: { content, changed: false, reason: `renaming would leave ${path.basename(filePath)} unparsable (${errors[0]})` },
      unhandled: references,
    };
  }
  return { result: { content: next, changed: true }, unhandled };
}

export interface ScreenNames {
  from: string;
  to: string;
  fromComponent: string;
  toComponent: string;
}

function commentRenameEdits(file: ts.SourceFile, content: string, names: ScreenNames): TextEdit[] {
  const edits: TextEdit[] = [];
  for (const [start, end] of commentRanges(file)) {
    const comment = content.slice(start, end);
    const renamed = comment
      .replace(new RegExp(`\\b${names.fromComponent}\\b`, 'g'), names.toComponent)
      .replace(new RegExp(`(['"\`])${names.from}\\1`, 'g'), `$1${names.to}$1`);
    if (renamed !== comment) edits.push({ start, end, text: renamed });
  }
  return edits;
}

/**
 * The quoted route name and the component name inside comments — the generated docs say
 * `navigation.navigate('Order')` and `<Stack.Screen name="Order" …>`, and a file whose
 * code now says Invoice shouldn't keep telling its reader Order.
 */
export function renameInComments(content: string, filePath: string, names: ScreenNames): string {
  return applyEdits(content, commentRenameEdits(parseSource(content, filePath), content, names));
}

/**
 * Inside the screen's own files: the component's name wherever it is declared, used or
 * exported, the generated `<Text>Order</Text>` label, and the names in comments.
 */
export function renameInScreenFile(content: string, filePath: string, names: ScreenNames): string {
  const file = parseSource(content, filePath);
  const edits = identifierRenames(file, names.fromComponent, names.toComponent, { renameImportedName: true });

  // The generated placeholder label, <Text>Order</Text> — only an exact match.
  walk(file, (node) => {
    if (!ts.isJsxText(node) || node.text.trim() !== names.from) return;
    const start = node.getFullStart() + node.text.indexOf(names.from);
    edits.push({ start, end: start + names.from.length, text: names.to });
  });

  edits.push(...commentRenameEdits(file, content, names));
  return applyEdits(content, edits);
}
