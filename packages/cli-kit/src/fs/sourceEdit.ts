/**
 * FILE: sourceEdit.ts
 * PATH: packages/cli-kit/src/fs/sourceEdit.ts
 *
 * WHAT: Parser-backed text edits for source files the user owns: parse with the
 *       TypeScript compiler, find the node to change, splice text at its position.
 * WHY:  The first create-screen placed lines with regexes, and a regex cannot tell a
 *       comment from code or a one-line JSX element from the first line of a
 *       multi-line one. Run against the files init really generates, it matched
 *       examples inside doc comments, broke Prettier-formatted screens, dropped the
 *       import in files without semicolons and gave up on Windows line endings. The
 *       TypeScript parser was already a dependency; it knows all of those things.
 * HOW:  Nothing is ever re-printed. An edit is a {start, end, text} splice on the
 *       original string, so every byte the user wrote — comments, blank lines, quote
 *       style, trailing commas — survives. New text copies the indentation, line
 *       ending, quote and semicolon style already in the file.
 * WHEN: Used by navigatorPatcher, navigationDiscovery and routeReferences.
 *
 * EXPORTS: TextEdit, SourceValue, ImportBinding, parseSource, sourceSyntaxErrors,
 *          applyEdits, walk, eolOf, lineStartOf, commaAfter, indentAt, indentUnitOf, lineAfter,
 *          removalOf, propertyName, findProperty, quoteString, stringQuoteOf,
 *          importStyleOf, importBindings, topLevelDeclarationNames, declaresType,
 *          defaultImportInsertion, unusedImportRemoval, renderValue, keyText,
 *          propertyInsertion, blockInsertion, jsxOpening, jsxTag, jsxAttribute,
 *          jsxStringAttribute, jsxIdentifierAttribute, identifierRenames,
 *          commentRanges, samePathSpec
 * DEPENDS ON: typescript
 * USED BY: ./navigatorPatcher.ts, ./navigationDiscovery.ts, ./routeReferences.ts
 */

import ts from 'typescript';

export interface TextEdit {
  start: number;
  end: number;
  text: string;
}

function scriptKindFor(fileName: string): ts.ScriptKind {
  if (fileName.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (/\.[mc]?ts$/.test(fileName)) return ts.ScriptKind.TS;
  // A React Native app's .js files routinely contain JSX.
  return ts.ScriptKind.JSX;
}

export function parseSource(content: string, fileName: string): ts.SourceFile {
  return ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true, scriptKindFor(fileName));
}

/** Syntax errors only — no type information, no program. Empty means it parses. */
export function sourceSyntaxErrors(content: string, fileName: string): string[] {
  const file = parseSource(content, fileName);
  // parseDiagnostics is internal but stable, and there is no public parse-only API.
  const diagnostics = (file as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics;
  return (diagnostics ?? []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '));
}

/**
 * Applies splices against the ORIGINAL positions.
 *
 * Two inserts at the same position land in the order they were listed, which is what
 * lets a caller say "a comma after the last entry, then the new entry" at one offset.
 */
export function applyEdits(content: string, edits: TextEdit[]): string {
  const ordered = edits
    .map((edit, index) => ({ edit, index }))
    .sort((a, b) => b.edit.start - a.edit.start || b.index - a.index);

  let result = content;
  for (const { edit } of ordered) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }
  return result;
}

export function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

export function eolOf(content: string): string {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

export function lineStartOf(content: string, position: number): number {
  return content.lastIndexOf('\n', position - 1) + 1;
}

/**
 * The end of the comma that follows `position`, skipping whitespace and comments, or
 * null when the next token isn't a comma. Searching the text for ',' found the one
 * inside `'home' /* first, default *\/,` and wrote the new entry into the comment.
 */
export function commaAfter(content: string, position: number): number | null {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, content);
  scanner.setText(content, position);
  return scanner.scan() === ts.SyntaxKind.CommaToken ? scanner.getTokenEnd() : null;
}

/** The leading whitespace of the line `position` is on. */
export function indentAt(content: string, position: number): string {
  return /^[ \t]*/.exec(content.slice(lineStartOf(content, position)))?.[0] ?? '';
}

/**
 * One level of indentation as this file writes it.
 *
 * The smallest non-zero indent wins, ignoring JSDoc continuation lines (` * …`), whose
 * single space is alignment rather than a level.
 */
export function indentUnitOf(content: string): string {
  let smallest: string | null = null;
  for (const line of content.split('\n')) {
    const match = /^([ \t]+)(\S)/.exec(line);
    if (!match?.[1] || match[2] === '*') continue;
    if (match[1].startsWith('\t')) return '\t';
    if (smallest === null || match[1].length < smallest.length) smallest = match[1];
  }
  return smallest ?? '  ';
}

/**
 * Puts `line` on a new line after the node ending at `nodeEnd`.
 *
 * When only commas, semicolons, whitespace or a trailing comment follow the node on its
 * line, the new line goes after that whole line — `<A /> // note` stays intact.
 * Otherwise it goes straight after the node.
 */
export function lineAfter(content: string, nodeEnd: number, indent: string, line: string): TextEdit {
  const eol = eolOf(content);
  const newline = content.indexOf('\n', nodeEnd);
  const rest = content.slice(nodeEnd, newline === -1 ? content.length : newline).replace(/\r$/, '');

  if (newline !== -1 && /^[\s,;]*(\/\/.*|\/\*.*?\*\/\s*)?$/.test(rest)) {
    return { start: newline + 1, end: newline + 1, text: `${indent}${line}${eol}` };
  }
  return { start: nodeEnd, end: nodeEnd, text: `${eol}${indent}${line}` };
}

/**
 * Removes [start, end), and the whole line it sat on when nothing else shares it.
 * `trailingComma` also takes the comma that separated it from the next entry.
 */
export function removalOf(
  content: string,
  start: number,
  end: number,
  options: { trailingComma?: boolean } = {},
): TextEdit {
  let finish = end;
  if (options.trailingComma) finish = commaAfter(content, finish) ?? finish;

  const lineStart = lineStartOf(content, start);
  const newline = content.indexOf('\n', finish);
  const lineEnd = newline === -1 ? content.length : newline;
  const before = content.slice(lineStart, start);
  const after = content.slice(finish, lineEnd).replace(/\r$/, '');

  if (/^\s*$/.test(before) && /^\s*(\/\/.*)?$/.test(after)) {
    return { start: lineStart, end: newline === -1 ? content.length : newline + 1, text: '' };
  }
  return { start, end: finish, text: '' };
}

export function propertyName(name: ts.PropertyName | ts.JsxAttributeName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) {
    return name.text;
  }
  return null;
}

export function findProperty(
  object: ts.ObjectLiteralExpression,
  key: string,
): ts.PropertyAssignment | undefined {
  return object.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) && propertyName(property.name) === key,
  );
}

/** A string literal in the given quote style. */
export function quoteString(value: string, quote: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(new RegExp(quote, 'g'), `\\${quote}`);
  return `${quote}${escaped}${quote}`;
}

/** The quote character the file's string literals use; single when there are none. */
export function stringQuoteOf(file: ts.SourceFile): string {
  let quote: string | null = null;
  walk(file, (node) => {
    if (quote || !ts.isStringLiteral(node)) return;
    // JSX attribute strings follow JSX conventions, not the file's.
    if (ts.isJsxAttribute(node.parent)) return;
    quote = file.text[node.getStart(file)] === '"' ? '"' : "'";
  });
  return quote ?? "'";
}

export interface ImportStyle {
  quote: string;
  semicolon: boolean;
}

export function importStyleOf(file: ts.SourceFile): ImportStyle {
  const imports = file.statements.filter(ts.isImportDeclaration);
  const sample = imports[imports.length - 1];
  if (!sample) {
    const statement = file.statements[0];
    return { quote: stringQuoteOf(file), semicolon: statement ? statement.getText(file).trimEnd().endsWith(';') : true };
  }
  return {
    quote: file.text[sample.moduleSpecifier.getStart(file)] === '"' ? '"' : "'",
    semicolon: sample.getText(file).trimEnd().endsWith(';'),
  };
}

export interface ImportBinding {
  /** The name it is bound to in this file. */
  local: string;
  /** 'default', '*', or the exported name. */
  imported: string;
  module: string;
  declaration: ts.ImportDeclaration;
}

export function importBindings(file: ts.SourceFile): ImportBinding[] {
  const bindings: ImportBinding[] = [];
  for (const declaration of file.statements.filter(ts.isImportDeclaration)) {
    if (!ts.isStringLiteral(declaration.moduleSpecifier)) continue;
    const module = declaration.moduleSpecifier.text;
    const clause = declaration.importClause;
    if (!clause) continue;
    if (clause.name) bindings.push({ local: clause.name.text, imported: 'default', module, declaration });
    const named = clause.namedBindings;
    if (named && ts.isNamespaceImport(named)) {
      bindings.push({ local: named.name.text, imported: '*', module, declaration });
    } else if (named) {
      for (const element of named.elements) {
        bindings.push({
          local: element.name.text,
          imported: (element.propertyName ?? element.name).text,
          module,
          declaration,
        });
      }
    }
  }
  return bindings;
}

/** Names declared at the top level of the file by anything other than an import. */
export function topLevelDeclarationNames(file: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of file.statements) {
    if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name
    ) {
      names.add(statement.name.text);
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
      }
    }
  }
  return names;
}

export function declaresType(file: ts.SourceFile, typeName: string): boolean {
  return file.statements.some(
    (statement) =>
      (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) &&
      statement.name.text === typeName,
  );
}

/** `import Local from 'module';`, after the last import, in the file's own style. */
export function defaultImportInsertion(
  content: string,
  file: ts.SourceFile,
  local: string,
  module: string,
): TextEdit {
  const style = importStyleOf(file);
  const line = `import ${local} from ${quoteString(module, style.quote)}${style.semicolon ? ';' : ''}`;
  const imports = file.statements.filter(ts.isImportDeclaration);
  const last = imports[imports.length - 1];
  if (last) return lineAfter(content, last.getEnd(), '', line);

  const eol = eolOf(content);
  const first = file.statements[0];
  // getStart skips leading trivia, so the import lands below a header comment.
  const at = first ? first.getStart(file) : content.length;
  return { start: at, end: at, text: `${line}${eol}${first ? eol : ''}` };
}

/**
 * Adds `import { name } from 'module'`, or null when the file already has it.
 *
 * A name joins an existing import of the same module rather than opening a second
 * declaration for it: two imports of one module is valid code that no formatter
 * merges and every reviewer stops on.
 */
export function namedImportInsertion(
  content: string,
  file: ts.SourceFile,
  name: string,
  module: string,
): TextEdit | null {
  const imports = file.statements.filter(ts.isImportDeclaration);

  const existing = imports.find(
    (declaration) =>
      ts.isStringLiteral(declaration.moduleSpecifier) &&
      samePathSpec(declaration.moduleSpecifier.text, module),
  );
  const bindings = existing?.importClause?.namedBindings;

  if (bindings && ts.isNamedImports(bindings)) {
    if (bindings.elements.some((element) => element.name.text === name)) return null;
    const last = bindings.elements[bindings.elements.length - 1];
    // `import {} from '…'` is rare but legal, and the braces are already there.
    return last
      ? { start: last.getEnd(), end: last.getEnd(), text: `, ${name}` }
      : { start: bindings.getEnd() - 1, end: bindings.getEnd() - 1, text: name };
  }

  const style = importStyleOf(file);
  const line = `import { ${name} } from ${quoteString(module, style.quote)}${style.semicolon ? ';' : ''}`;
  const last = imports[imports.length - 1];
  if (last) return lineAfter(content, last.getEnd(), '', line);

  const eol = eolOf(content);
  const first = file.statements[0];
  // getStart skips leading trivia, so the import lands below a header comment.
  const at = first ? first.getStart(file) : content.length;
  return { start: at, end: at, text: `${line}${eol}${first ? eol : ''}` };
}

/**
 * Removes `local` from its import when nothing else in the file uses it — the whole
 * declaration when it's the only name, just the name when the import brings in others.
 */
export function unusedImportRemoval(content: string, file: ts.SourceFile, local: string): TextEdit | null {
  const binding = importBindings(file).find((entry) => entry.local === local);
  if (!binding) return null;

  let uses = 0;
  walk(file, (node) => {
    if (!ts.isIdentifier(node) || node.text !== local) return;
    // A key or a member name that happens to be spelled the same — `server: { fs: … }`,
    // `config.fs` — isn't a use of the binding.
    const owner = node.parent;
    if (
      ((ts.isPropertyAssignment(owner) || ts.isPropertyAccessExpression(owner) || ts.isPropertySignature(owner) ||
        ts.isMethodDeclaration(owner) || ts.isPropertyDeclaration(owner)) &&
        owner.name === node)
    ) {
      return;
    }
    let parent: ts.Node | undefined = node.parent;
    while (parent && !ts.isImportDeclaration(parent)) parent = parent.parent;
    if (!parent) uses += 1;
  });
  if (uses > 0) return null;

  const declaration = binding.declaration;
  const clause = declaration.importClause;
  const named = clause?.namedBindings;
  const elements = named && ts.isNamedImports(named) ? named.elements : null;
  const bindingCount = (clause?.name ? 1 : 0) + (elements ? elements.length : named ? 1 : 0);
  if (!clause || bindingCount === 1) return removalOf(content, declaration.getStart(file), declaration.getEnd());

  // `import Home, { Order } from …` without Home → `import { Order } from …`
  if (clause.name?.text === local) {
    const comma = commaAfter(content, clause.name.getEnd());
    if (comma === null) return null;
    let end = comma;
    while (content[end] === ' ' || content[end] === '\t') end += 1;
    return { start: clause.name.getStart(file), end, text: '' };
  }

  const element = elements?.find((entry) => entry.name.text === local);
  if (!elements || !element || !named) return null;
  // `import Home, { Order } from …` without Order → `import Home from …`
  if (elements.length === 1) return clause.name ? { start: clause.name.getEnd(), end: named.getEnd(), text: '' } : null;
  const index = elements.indexOf(element);
  // The last name takes the comma before it: `{ Home, Order }` → `{ Home }`.
  if (index === elements.length - 1) return { start: elements[index - 1]!.getEnd(), end: element.getEnd(), text: '' };
  const removal = removalOf(content, element.getStart(file), element.getEnd(), { trailingComma: true });
  return removal.start === element.getStart(file) && content[removal.end] === ' ' ? { ...removal, end: removal.end + 1 } : removal;
}

/** Code for a value: a string is raw code, an object renders as an object literal. */
export type SourceValue = string | { [key: string]: SourceValue };

export function keyText(key: string, quote: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : quoteString(key, quote);
}

interface RenderStyle {
  indent: string;
  unit: string;
  eol: string;
  inline: boolean;
  trailingComma: boolean;
  quote: string;
}

export function renderValue(value: SourceValue, style: RenderStyle): string {
  // Raw code spanning lines is written relative to its key, so each line takes the key's indent.
  if (typeof value === 'string') return value.replace(/\r?\n/g, `${style.eol}${style.indent}`);
  const entries = Object.entries(value);
  if (entries.length === 0) return '{}';
  if (style.inline) {
    return `{ ${entries.map(([key, entry]) => `${keyText(key, style.quote)}: ${renderValue(entry, style)}`).join(', ')} }`;
  }
  const inner = style.indent + style.unit;
  const lines = entries.map(
    ([key, entry], index) =>
      `${inner}${keyText(key, style.quote)}: ${renderValue(entry, { ...style, indent: inner })}${
        index < entries.length - 1 || style.trailingComma ? ',' : ''
      }`,
  );
  return `{${style.eol}${lines.join(style.eol)}${style.eol}${style.indent}}`;
}

/**
 * Text between an opening and closing delimiter that currently hold nothing (maybe a
 * comment): `{}` becomes a block, a multi-line empty block gains a line at its top —
 * above any comment in it, since init's configs document their entries in a comment
 * that follows them.
 */
export function blockInsertion(content: string, openEnd: number, closeStart: number, line: string): TextEdit {
  const eol = eolOf(content);
  const unit = indentUnitOf(content);
  const outer = indentAt(content, openEnd - 1);

  if (!content.slice(openEnd, closeStart).includes('\n')) {
    return { start: openEnd, end: closeStart, text: `${eol}${outer}${unit}${line}${eol}${outer}` };
  }

  const closeLine = lineStartOf(content, closeStart);
  if (/^\s*$/.test(content.slice(closeLine, closeStart))) {
    const firstLine = content.indexOf('\n', openEnd) + 1;
    return { start: firstLine, end: firstLine, text: `${indentAt(content, closeStart)}${unit}${line}${eol}` };
  }
  return { start: closeStart, end: closeStart, text: `${eol}${outer}${unit}${line}${eol}${outer}` };
}

/** Adds `key: value` to an object literal, matching its layout and trailing commas. */
export function propertyInsertion(
  content: string,
  file: ts.SourceFile,
  object: ts.ObjectLiteralExpression,
  key: string,
  value: SourceValue,
): TextEdit[] {
  const eol = eolOf(content);
  const unit = indentUnitOf(content);
  const quote = stringQuoteOf(file);
  const open = object.getStart(file);
  const close = object.getEnd() - 1;
  const properties = object.properties;
  const last = properties[properties.length - 1];

  if (!last) {
    const indent = indentAt(content, open) + unit;
    const rendered = `${keyText(key, quote)}: ${renderValue(value, { indent, unit, eol, inline: false, trailingComma: true, quote })},`;
    return [blockInsertion(content, open + 1, close, rendered)];
  }

  const trailing = properties.hasTrailingComma;
  const afterLast = trailing ? (commaAfter(content, last.getEnd()) ?? last.getEnd()) : last.getEnd();

  if (!content.slice(open, close).includes('\n')) {
    const rendered = `${keyText(key, quote)}: ${renderValue(value, { indent: '', unit, eol, inline: true, trailingComma: false, quote })}`;
    return [{ start: afterLast, end: afterLast, text: trailing ? ` ${rendered},` : `, ${rendered}` }];
  }

  const indent = indentAt(content, last.getStart(file));
  const rendered = `${keyText(key, quote)}: ${renderValue(value, { indent, unit, eol, inline: false, trailingComma: trailing, quote })}`;
  const edits: TextEdit[] = [];
  if (!trailing) edits.push({ start: last.getEnd(), end: last.getEnd(), text: ',' });
  edits.push(lineAfter(content, afterLast, indent, `${rendered}${trailing ? ',' : ''}`));
  return edits;
}

export function jsxOpening(node: ts.JsxElement | ts.JsxSelfClosingElement): ts.JsxOpeningLikeElement {
  return ts.isJsxElement(node) ? node.openingElement : node;
}

export function jsxTag(node: ts.JsxElement | ts.JsxSelfClosingElement): string {
  return jsxOpening(node).tagName.getText();
}

export function jsxAttribute(opening: ts.JsxOpeningLikeElement, name: string): ts.JsxAttribute | undefined {
  return opening.attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && property.name.getText() === name,
  );
}

/** The literal inside `name="x"`, `name={'x'}` or name={`x`}; null for anything computed. */
export function jsxStringLiteralOf(attribute: ts.JsxAttribute | undefined): ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | null {
  const initializer = attribute?.initializer;
  if (!initializer) return null;
  if (ts.isStringLiteral(initializer)) return initializer;
  if (
    ts.isJsxExpression(initializer) && initializer.expression &&
    (ts.isStringLiteral(initializer.expression) || ts.isNoSubstitutionTemplateLiteral(initializer.expression))
  ) {
    return initializer.expression;
  }
  return null;
}

export function jsxStringAttribute(opening: ts.JsxOpeningLikeElement, name: string): string | null {
  return jsxStringLiteralOf(jsxAttribute(opening, name))?.text ?? null;
}

/** The identifier inside `component={X}`. */
export function jsxIdentifierAttribute(opening: ts.JsxOpeningLikeElement, name: string): string | null {
  const initializer = jsxAttribute(opening, name)?.initializer;
  if (initializer && ts.isJsxExpression(initializer) && initializer.expression && ts.isIdentifier(initializer.expression)) {
    return initializer.expression.text;
  }
  return null;
}

/**
 * Every use of an identifier as a binding or reference — not as a property key.
 * `{ OrderScreen }` in an import becomes `{ OrderScreen as InvoiceScreen }`, keeping the
 * imported name, unless `renameImportedName` says the export itself was renamed.
 */
export function identifierRenames(
  file: ts.SourceFile,
  from: string,
  to: string,
  options: { renameImportedName?: boolean } = {},
): TextEdit[] {
  const edits: TextEdit[] = [];
  walk(file, (node) => {
    if (!ts.isIdentifier(node) || node.text !== from) return;
    const parent = node.parent;
    if (ts.isPropertyAccessExpression(parent) && parent.name === node) return;
    if ((ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isMethodDeclaration(parent)) && parent.name === node) return;
    if (ts.isJsxAttribute(parent)) return;
    if (ts.isImportSpecifier(parent) && parent.propertyName === node) return;
    // `export { X } from './y'` names y's export, not a binding in this file.
    if (ts.isExportSpecifier(parent) && parent.parent.parent.moduleSpecifier) return;
    const start = node.getStart(file);
    if (ts.isShorthandPropertyAssignment(parent)) {
      edits.push({ start, end: node.getEnd(), text: `${from}: ${to}` });
    } else if (ts.isImportSpecifier(parent) && !parent.propertyName && !options.renameImportedName) {
      edits.push({ start, end: node.getEnd(), text: `${from} as ${to}` });
    } else {
      edits.push({ start, end: node.getEnd(), text: to });
    }
  });
  return edits;
}

/** [start, end) of every comment in the file. */
export function commentRanges(file: ts.SourceFile): Array<[number, number]> {
  const text = file.text;
  const seen = new Map<number, number>();
  const collect = (ranges: ts.CommentRange[] | undefined) => {
    for (const range of ranges ?? []) seen.set(range.pos, range.end);
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) return;
    collect(ts.getLeadingCommentRanges(text, node.getFullStart()));
    collect(ts.getTrailingCommentRanges(text, node.getEnd()));
    for (const child of node.getChildren(file)) visit(child);
  };
  visit(file);
  return [...seen.entries()].sort((a, b) => a[0] - b[0]);
}

/** Two module specifiers naming the same file, give or take `/index` and an extension. */
export function samePathSpec(a: string, b: string): boolean {
  const normalize = (spec: string) => spec.replace(/\.[jt]sx?$/, '').replace(/\/index$/, '').replace(/\/$/, '');
  return normalize(a) === normalize(b);
}
