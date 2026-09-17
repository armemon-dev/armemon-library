/**
 * FILE: runtimeGeneratedPatcher.ts
 * PATH: packages/cli-kit/src/fs/runtimeGeneratedPatcher.ts
 *
 * WHAT: Adds a plugin to, or removes one from, an existing runtime.generated — its
 *       import, its place in `plugins: [...]`, and the RuntimeConfig values it
 *       contributes (the splash screen component, the minimum splash time, …).
 * WHY:  `armemon plugin add/remove` regenerate runtime.generated when it is still
 *       exactly what armemon wrote. When it isn't — someone registered a plugin by
 *       hand, or `sync` reformatted it — rebuilding it would drop that work, so the
 *       change is made in place instead, through the parser.
 * HOW:  Three passes, each re-parsed: removals, then contributed values, then additions.
 *       A new plugin gets the next free `pluginN` name. Values are inserted above the
 *       `...runtimeOverrides` spread, so what the person sets in runtime.config still
 *       wins, exactly as in a generated file.
 * WHEN: By the plugin add/remove appliers, when runtime.generated has been changed.
 *
 * EXPORTS: RuntimePluginRef, RuntimeGeneratedEdit, patchRuntimeGenerated
 * DEPENDS ON: typescript, @armemon-library/config-types, ./sourceEdit, ./arrayLiteralEdit,
 *             ./patchResult
 * USED BY: packages/cli-armemon/src/flows/plugins/reconcile.ts
 */

import ts from 'typescript';
import type { RuntimeConfigContributions } from '@armemon-library/config-types';
import {
  applyEdits,
  eolOf,
  importStyleOf,
  indentAt,
  lineAfter,
  lineStartOf,
  parseSource,
  propertyName,
  quoteString,
  removalOf,
  samePathSpec,
  type TextEdit,
} from './sourceEdit.js';
import { arrayElementInsertion, arrayElementRemoval } from './arrayLiteralEdit.js';
import { brokenReason, checked, done, refused, type PatchResult } from './patchResult.js';

export interface RuntimePluginRef {
  /** The export to register, e.g. `UiPlugin`. */
  importName: string;
  /** Where it comes from, as written in the file: `./ui/index`, `@armemon-library/advanced-init`. */
  from: string;
}

export interface RuntimeGeneratedEdit {
  /** Placed before the plugin imported from `before` when there is one, else at the end. */
  addPlugins?: Array<RuntimePluginRef & { before?: string }>;
  /** By the module they are imported from. */
  removePlugins?: string[];
  /** The combined contributions of every plugin, before and after the change. */
  contributions?: { before: RuntimeConfigContributions; after: RuntimeConfigContributions };
}

const COMPONENT_KEYS = {
  splashScreenComponent: 'SplashScreenComponent',
  errorScreenComponent: 'ErrorScreenComponent',
} as const;

/** The properties a generated file writes for these contributions, as source text by key. */
function contributedProperties(contributions: RuntimeConfigContributions): Map<string, string> {
  const properties = new Map<string, string>();
  for (const [key, local] of Object.entries(COMPONENT_KEYS)) {
    if (contributions[key as keyof typeof COMPONENT_KEYS]) properties.set(local, local);
  }
  if (typeof contributions.minSplashDurationMs === 'number' && contributions.minSplashDurationMs > 0) {
    properties.set('minSplashDurationMs', `minSplashDurationMs: ${contributions.minSplashDurationMs}`);
  }
  if (contributions.readyCustom) {
    properties.set('readyCustom', 'readyCustom: true');
    if (typeof contributions.readyCustomTimeout === 'number') {
      properties.set('readyCustomTimeout', `readyCustomTimeout: ${contributions.readyCustomTimeout}`);
    }
  }
  return properties;
}

interface RuntimeShape {
  file: ts.SourceFile;
  config: ts.ObjectLiteralExpression;
  plugins: ts.ArrayLiteralExpression;
}

function shapeOf(content: string, fileName: string): RuntimeShape | string {
  const file = parseSource(content, fileName);
  let config: ts.ObjectLiteralExpression | null = null;
  const visit = (node: ts.Node): void => {
    if (config) return;
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'registerRuntimeConfig' &&
      node.arguments[0] &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      config = node.arguments[0];
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!config) return 'it has no `registerRuntimeConfig({ … })` call';

  const plugins = (config as ts.ObjectLiteralExpression).properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) && propertyName(property.name) === 'plugins',
  );
  if (!plugins || !ts.isArrayLiteralExpression(plugins.initializer)) {
    return 'its `plugins` is not a plain list';
  }
  return { file, config, plugins: plugins.initializer };
}

/** The import declaration bringing in `from`, and the local name the file uses for it. */
function pluginImport(file: ts.SourceFile, from: string): { declaration: ts.ImportDeclaration; local: string } | null {
  for (const declaration of file.statements.filter(ts.isImportDeclaration)) {
    if (!ts.isStringLiteral(declaration.moduleSpecifier) || !samePathSpec(declaration.moduleSpecifier.text, from)) continue;
    const named = declaration.importClause?.namedBindings;
    if (!named || !ts.isNamedImports(named) || named.elements.length !== 1) continue;
    return { declaration, local: named.elements[0]!.name.text };
  }
  return null;
}

function identifierElement(array: ts.ArrayLiteralExpression, local: string): ts.Expression | undefined {
  return array.elements.find((element) => ts.isIdentifier(element) && element.text === local);
}

function propertyNode(config: ts.ObjectLiteralExpression, key: string): ts.ObjectLiteralElementLike | undefined {
  return config.properties.find(
    (property) =>
      (ts.isShorthandPropertyAssignment(property) || ts.isPropertyAssignment(property)) &&
      propertyName(property.name) === key,
  );
}

/** A property line inserted above the `...runtimeOverrides` spread and its comment. */
function propertyAboveSpread(content: string, file: ts.SourceFile, config: ts.ObjectLiteralExpression, text: string): TextEdit {
  const eol = eolOf(content);
  const spread = config.properties.find(ts.isSpreadAssignment);
  if (spread) {
    const comments = ts.getLeadingCommentRanges(content, spread.getFullStart()) ?? [];
    const anchor = comments[0]?.pos ?? spread.getStart(file);
    const lineStart = lineStartOf(content, anchor);
    return { start: lineStart, end: lineStart, text: `${indentAt(content, spread.getStart(file))}${text},${eol}` };
  }
  const last = config.properties[config.properties.length - 1];
  if (!last) return { start: config.getStart(file) + 1, end: config.getStart(file) + 1, text: ` ${text},` };
  return lineAfter(content, last.getEnd(), indentAt(content, last.getStart(file)), `${text},`);
}

export function patchRuntimeGenerated(
  content: string,
  edit: RuntimeGeneratedEdit,
  fileName = 'runtime.generated.ts',
): PatchResult {
  const manual = 'Register the plugin in runtime.generated by hand: import its export and list it in `plugins: [...]`.';
  const broken = brokenReason(content, fileName);
  if (broken) return refused(content, broken, manual);

  let current = content;
  const reshape = (): RuntimeShape | PatchResult => {
    const shape = shapeOf(current, fileName);
    return typeof shape === 'string' ? refused(content, `runtime.generated can't be edited: ${shape}`, manual) : shape;
  };

  // ---- 1. removals -----------------------------------------------------------------
  if (edit.removePlugins?.length) {
    const shape = reshape();
    if ('changed' in shape) return shape;
    const edits: TextEdit[] = [];
    const elements: ts.Expression[] = [];
    for (const from of edit.removePlugins) {
      const found = pluginImport(shape.file, from);
      if (!found) continue;
      const element = identifierElement(shape.plugins, found.local);
      if (element) elements.push(element);
      edits.push(removalOf(current, found.declaration.getStart(shape.file), found.declaration.getEnd()));
    }
    edits.push(...arrayElementRemoval(current, shape.file, shape.plugins, elements));
    current = applyEdits(current, edits);
  }

  // ---- 2. contributed values -----------------------------------------------------------
  if (edit.contributions) {
    const before = contributedProperties(edit.contributions.before);
    const after = contributedProperties(edit.contributions.after);
    const componentFrom = (contributions: RuntimeConfigContributions, local: string) => {
      const key = (Object.keys(COMPONENT_KEYS) as Array<keyof typeof COMPONENT_KEYS>).find((entry) => COMPONENT_KEYS[entry] === local);
      return key ? contributions[key] : undefined;
    };
    const changedKeys = [...new Set([...before.keys(), ...after.keys()])].filter((key) => {
      if (before.get(key) !== after.get(key)) return true;
      const a = componentFrom(edit.contributions!.before, key);
      const b = componentFrom(edit.contributions!.after, key);
      return JSON.stringify(a) !== JSON.stringify(b);
    });

    if (changedKeys.length > 0) {
      let shape = reshape();
      if ('changed' in shape) return shape;
      const removals: TextEdit[] = [];
      for (const key of changedKeys) {
        const node = propertyNode(shape.config, key);
        if (node) removals.push(removalOf(current, node.getStart(shape.file), node.getEnd(), { trailingComma: true }));
        const old = componentFrom(edit.contributions.before, key);
        if (old) {
          const found = shape.file.statements.filter(ts.isImportDeclaration).find((declaration) => {
            const named = declaration.importClause?.namedBindings;
            return named && ts.isNamedImports(named) && named.elements.some((element) => element.name.text === key);
          });
          if (found) removals.push(removalOf(current, found.getStart(shape.file), found.getEnd()));
        }
      }
      current = applyEdits(current, removals);

      shape = reshape();
      if ('changed' in shape) return shape;
      const style = importStyleOf(shape.file);
      const additions: TextEdit[] = [];
      for (const key of changedKeys) {
        const text = after.get(key);
        if (!text) continue;
        additions.push(propertyAboveSpread(current, shape.file, shape.config, text));
        const component = componentFrom(edit.contributions.after, key);
        if (component) {
          const imports = shape.file.statements.filter(ts.isImportDeclaration);
          const anchor = imports.filter((declaration) => !/runtime\.config/.test(declaration.moduleSpecifier.getText(shape.file))).pop();
          const line = `import { ${component.importName} as ${key} } from ${quoteString(component.from, style.quote)}${style.semicolon ? ';' : ''}`;
          if (anchor) additions.push(lineAfter(current, anchor.getEnd(), '', line));
        }
      }
      current = applyEdits(current, additions);
    }
  }

  // ---- 3. additions --------------------------------------------------------------------
  if (edit.addPlugins?.length) {
    const shape = reshape();
    if ('changed' in shape) return shape;
    const style = importStyleOf(shape.file);
    const imports = shape.file.statements.filter(ts.isImportDeclaration);

    const used = new Set<number>();
    for (const declaration of imports) {
      const named = declaration.importClause?.namedBindings;
      if (!named || !ts.isNamedImports(named)) continue;
      for (const element of named.elements) {
        const match = /^plugin(\d+)$/.exec(element.name.text);
        if (match) used.add(Number(match[1]));
      }
    }
    let next = used.size > 0 ? Math.max(...used) + 1 : 0;

    const pluginImports = imports.filter((declaration) => {
      const named = declaration.importClause?.namedBindings;
      return named && ts.isNamedImports(named) && named.elements.some((element) => /^plugin\d+$/.test(element.name.text));
    });
    const importAnchor = pluginImports[pluginImports.length - 1] ?? imports[0];
    if (!importAnchor) return refused(content, 'runtime.generated has no imports to add to', manual);

    const edits: TextEdit[] = [];
    const lines: string[] = [];
    const byIndex = new Map<number, string[]>();
    for (const plugin of edit.addPlugins) {
      if (pluginImport(shape.file, plugin.from)) continue;
      const local = `plugin${next}`;
      next += 1;
      lines.push(
        `import { ${plugin.importName} as ${local} } from ${quoteString(plugin.from, style.quote)}${style.semicolon ? ';' : ''}`,
      );
      const beforeImport = plugin.before ? pluginImport(shape.file, plugin.before) : null;
      const beforeElement = beforeImport ? identifierElement(shape.plugins, beforeImport.local) : undefined;
      const index = beforeElement ? shape.plugins.elements.indexOf(beforeElement) : shape.plugins.elements.length;
      byIndex.set(index, [...(byIndex.get(index) ?? []), local]);
    }
    if (lines.length === 0 && current === content) return done(content, 'runtime.generated already registers these plugins');

    if (lines.length > 0) edits.push(lineAfter(current, importAnchor.getEnd(), '', lines.join(eolOf(current))));
    for (const [index, locals] of byIndex) {
      edits.push(...arrayElementInsertion(current, shape.file, shape.plugins, locals, index));
    }
    current = applyEdits(current, edits);
  }

  return checked(content, current, fileName, manual, 'runtime.generated already matches');
}
