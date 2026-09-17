/**
 * FILE: specifierRewrite.ts
 * PATH: packages/cli-kit/src/fs/specifierRewrite.ts
 *
 * WHAT: Rewrites the relative import and export specifiers in a file so they still
 *       point at the same modules after something moved.
 * WHY:  Moving the managed zone from src/armemon/ to armemon/ changes the distance
 *       of every import that crosses between the two zones — in both directions, and
 *       by a different amount depending on how deep each file sits. Doing that with
 *       string edits ("add one ../") is how a migration corrupts a project: it is
 *       wrong for any specifier that does not actually cross the boundary, and it
 *       silently produces paths that resolve to nothing.
 *
 *       So this never reasons about depth. It resolves each specifier against the
 *       file's OLD location to find the real module, asks where that module will be
 *       afterwards, and recomputes the specifier from the file's NEW location. A
 *       specifier whose target cannot be resolved is reported rather than guessed at.
 * HOW:  Parser-backed, so a matching string in a comment is never touched. Every place
 *       a module path can be written counts, not just import statements: require(),
 *       dynamic import(), `import x = require()`, `import('…')` types, and the module
 *       argument of jest.mock / vi.mock and their relatives — a test that mocks a
 *       managed module by path broke exactly as badly as an import would have.
 *       Specifiers written through a path alias (`@/armemon/…`) are resolved through
 *       the alias and rewritten too. Quote style is taken from the file, and the edits
 *       are applied back-to-front by applyEdits.
 * WHEN: By `armemon sync`, when it moves a legacy managed zone up to the app root.
 *
 * EXPORTS: SpecifierRewrite, RewriteOptions, rewriteModuleSpecifiers, readPathAliases,
 *          moduleReferences, packageNameOf
 * DEPENDS ON: node:path, typescript, ./sourceEdit
 * USED BY: packages/cli-armemon/src/flows/sync.ts
 */

import path from 'node:path';
import ts from 'typescript';
import { applyEdits, parseSource, quoteString, stringQuoteOf, type TextEdit } from './sourceEdit.js';

export interface SpecifierRewrite {
  content: string;
  changed: boolean;
  /** Specifiers that could not be resolved to a file, left exactly as they were. */
  unresolved: string[];
}

export interface RewriteOptions {
  /** Where the file lives now (absolute), for resolving what each specifier means. */
  fromFile: string;
  /** Where the file will live (absolute), for recomputing each specifier. */
  toFile: string;
  /**
   * Resolves a relative specifier to the absolute module it names, as it stands
   * before the move. Returning null means "cannot tell" — the specifier is left
   * alone and reported.
   */
  resolve: (fromFile: string, spec: string) => Promise<string | null>;
  /** Where a module that is moving ends up. Return the input for anything staying put. */
  relocate: (absoluteModule: string) => string;
  /**
   * The project's path aliases: `{ prefix: '@/', target: '/abs/app/src/' }` means
   * `@/x` is `src/x`. A specifier through one is resolved like a relative one; after
   * the move it keeps the alias if the alias still reaches the module, and becomes
   * relative if not.
   */
  aliases?: Array<{ prefix: string; target: string }>;
  /**
   * A path segment that marks a specifier as pointing into the moving folder even
   * when no known alias explains it — `armemon` for the managed zone. Such a
   * specifier is reported for a person to check, never rewritten.
   */
  watchSegment?: string;
}

/** Jest's and Vitest's calls whose first argument is a module path. */
const MODULE_PATH_CALLS = new Set([
  'jest.mock',
  'jest.doMock',
  'jest.unmock',
  'jest.dontMock',
  'jest.setMock',
  'jest.requireActual',
  'jest.requireMock',
  'jest.createMockFromModule',
  'jest.genMockFromModule',
  'vi.mock',
  'vi.doMock',
  'vi.unmock',
  'vi.doUnmock',
  'vi.importActual',
  'vi.importMock',
  'require.resolve',
]);

type SpecifierNode = ts.StringLiteral | ts.NoSubstitutionTemplateLiteral;

const isSpecifierNode = (node: ts.Node | undefined): node is SpecifierNode =>
  node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node));

/** Every string in the file that names a module, wherever the syntax put it. */
function specifierNodes(file: ts.SourceFile): SpecifierNode[] {
  const found: SpecifierNode[] = [];

  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && isSpecifierNode(node.moduleSpecifier)) {
      found.push(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      isSpecifierNode(node.moduleReference.expression)
    ) {
      found.push(node.moduleReference.expression);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && isSpecifierNode(node.argument.literal)) {
      found.push(node.argument.literal);
    } else if (ts.isCallExpression(node) && isSpecifierNode(node.arguments[0])) {
      const callee = node.expression;
      const name =
        callee.kind === ts.SyntaxKind.ImportKeyword
          ? 'import'
          : ts.isIdentifier(callee)
            ? callee.text
            : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)
              ? `${callee.expression.text}.${callee.name.text}`
              : null;
      if (name === 'import' || name === 'require' || (name !== null && MODULE_PATH_CALLS.has(name))) {
        found.push(node.arguments[0]);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(file);
  return found;
}

/**
 * Every module a file names — imports, re-exports, require(), import(), jest.mock() —
 * with the line it is on. What `armemon plugin remove` checks before taking a module
 * away.
 */
export function moduleReferences(content: string, fileName: string): Array<{ specifier: string; line: number }> {
  const file = parseSource(content, fileName);
  return specifierNodes(file).map((node) => ({
    specifier: node.text,
    line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
  }));
}

/** The package a bare specifier names — `@scope/name` or `name` — or null for a path. */
export function packageNameOf(specifier: string): string | null {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:') || /^[A-Za-z]:[\\/]/.test(specifier)) {
    return null;
  }
  const parts = specifier.split('/');
  if (specifier.startsWith('@')) return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  return parts[0] || null;
}

/** Extensionless, posix, no trailing /index — matching how armemon writes specifiers. */
function specifierBetween(fromFile: string, toModule: string): string {
  const relative = path
    .relative(path.dirname(fromFile), toModule)
    .split(path.sep)
    .join('/')
    .replace(/\.[jt]sx?$/, '')
    .replace(/\/index$/, '');
  return relative.startsWith('.') ? relative : `./${relative}`;
}

/**
 * Every module specifier in the file, rewritten for its new home.
 *
 * Only relative specifiers are considered: a package name means the same thing from
 * anywhere, and a path alias is the project's business, not armemon's.
 */
export async function rewriteModuleSpecifiers(
  content: string,
  options: RewriteOptions,
): Promise<SpecifierRewrite> {
  const { fromFile, toFile, resolve, relocate, aliases = [], watchSegment } = options;
  const file = parseSource(content, fromFile);
  const quote = stringQuoteOf(file);

  const edits: TextEdit[] = [];
  const unresolved: string[] = [];

  for (const specifier of specifierNodes(file)) {
    const spec = specifier.text;
    const alias = spec.startsWith('.') ? undefined : aliases.find((entry) => spec.startsWith(entry.prefix));

    let target: string | null;
    if (spec.startsWith('.')) {
      target = await resolve(fromFile, spec);
    } else if (alias) {
      // Resolved as the relative path the alias stands for, so a module that doesn't
      // exist is reported exactly like a broken relative import.
      const aliased = path.join(alias.target, spec.slice(alias.prefix.length));
      target = await resolve(fromFile, specifierBetween(fromFile, aliased));
    } else {
      // A package, or an alias armemon doesn't know. Left alone — but one that names
      // the moving folder is exactly the import that is about to break, so say so.
      if (watchSegment && spec.split('/').includes(watchSegment) && !spec.startsWith('@armemon-library/')) {
        unresolved.push(spec);
      }
      continue;
    }

    if (target === null) {
      unresolved.push(spec);
      continue;
    }

    const destination = relocate(target);
    let next: string;
    if (alias) {
      if (destination === target) continue;
      // Keep the alias while it still reaches the module; a relative path when the
      // module has moved out from under it.
      const inside = path.relative(alias.target, destination);
      next =
        inside.startsWith('..') || path.isAbsolute(inside)
          ? specifierBetween(toFile, destination)
          : `${alias.prefix}${specifierBetween(path.join(alias.target, 'index.ts'), destination).replace(/^\.\//, '')}`;
    } else {
      next = specifierBetween(toFile, destination);
    }
    if (next === spec) continue;

    edits.push({
      start: specifier.getStart(file),
      end: specifier.getEnd(),
      text: quoteString(next, quote),
    });
  }

  return {
    content: edits.length > 0 ? applyEdits(content, edits) : content,
    changed: edits.length > 0,
    unresolved,
  };
}

/**
 * The wildcard path aliases declared in the app's tsconfig.json or jsconfig.json:
 * `"@/*": ["./src/*"]` becomes `{ prefix: '@/', target: '<app>/src' }`.
 *
 * Read with TypeScript's own config reader, because a tsconfig is JSON with comments
 * and trailing commas that JSON.parse refuses. Only the first target of each pattern
 * is used — the one TypeScript tries first.
 */
export function readPathAliases(appRoot: string): Array<{ prefix: string; target: string }> {
  const aliases: Array<{ prefix: string; target: string }> = [];

  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    const read = ts.readConfigFile(path.join(appRoot, name), ts.sys.readFile);
    const compilerOptions = (
      read.config as { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } } | undefined
    )?.compilerOptions;
    if (!compilerOptions?.paths) continue;

    const base = path.resolve(appRoot, compilerOptions.baseUrl ?? '.');
    for (const [pattern, targets] of Object.entries(compilerOptions.paths)) {
      const target = targets[0];
      if (!pattern.endsWith('*') || !target?.endsWith('*')) continue;
      aliases.push({ prefix: pattern.slice(0, -1), target: path.resolve(base, target.slice(0, -1)) });
    }
  }

  return aliases;
}
