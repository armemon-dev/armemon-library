/**
 * FILE: viteConfigPatcher.ts
 * PATH: packages/cli-kit/src/fs/viteConfigPatcher.ts
 *
 * WHAT: Adds or removes what a plugin contributes to an existing web/vite.config — its
 *       import aliases, the packages Vite dedupes, and the env-file modules it serves.
 * WHY:  `armemon plugin add/remove` write the config again when it is still exactly
 *       what armemon generated. Once someone has tuned it — a proxy, another plugin —
 *       writing it again would drop that, so the plugin's own entries are edited in
 *       place instead.
 * HOW:  Parser-backed, like every other patcher: entries are found by what they are
 *       (`find: /^@(?=\/|$)/`, `'react-redux'`, `envModule('@env', …)`), so their
 *       position and formatting don't matter. An env module needs the `envModule`
 *       helper the generated config declares; when the last one goes, the helper and
 *       the imports only it used go with it.
 * WHEN: By the plugin add/remove appliers, for apps with a web target.
 *
 * EXPORTS: patchViteConfig, readViteDedupe, ViteConfigChange
 * DEPENDS ON: typescript, ../exec/webScaffold, ./sourceEdit, ./arrayLiteralEdit,
 *             ./languageConversion, ./patchResult
 * USED BY: packages/cli-armemon/src/flows/plugins/reconcile.ts
 */

import ts from 'typescript';
import { ENV_MODULE_PLUGIN, viteAliasEntry, viteEnvModuleCall } from '../exec/webScaffold.js';
import {
  applyEdits,
  eolOf,
  findProperty,
  indentAt,
  lineAfter,
  lineStartOf,
  namedImportInsertion,
  parseSource,
  removalOf,
  unusedImportRemoval,
  walk,
  type TextEdit,
} from './sourceEdit.js';
import { arrayElementInsertion, arrayElementRemoval } from './arrayLiteralEdit.js';
import { stripTypes } from './languageConversion.js';
import { brokenReason, checked, refused, type PatchResult } from './patchResult.js';

export interface ViteConfigChange {
  addAliases?: Record<string, string>;
  removeAliases?: string[];
  addDedupe?: string[];
  removeDedupe?: string[];
  addEnvModules?: Record<string, string>;
  removeEnvModules?: string[];
}

interface ViteShape {
  file: ts.SourceFile;
  config: ts.ObjectLiteralExpression;
  resolve: ts.ObjectLiteralExpression | null;
}

/** The object `defineConfig` is given, directly or returned from its function. */
function shapeOf(content: string, fileName: string): ViteShape | null {
  const file = parseSource(content, fileName);
  let config: ts.ObjectLiteralExpression | null = null;
  walk(file, (node) => {
    if (config || !ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== 'defineConfig') return;
    let argument = node.arguments[0];
    if (argument && ts.isArrowFunction(argument)) {
      let body: ts.Node = argument.body;
      while (ts.isParenthesizedExpression(body)) body = body.expression;
      if (ts.isBlock(body)) {
        const returned = body.statements.find(ts.isReturnStatement)?.expression;
        argument = returned;
      } else {
        argument = body as ts.Expression;
      }
    }
    if (argument && ts.isObjectLiteralExpression(argument)) config = argument;
  });
  if (!config) return null;
  const resolveProperty = findProperty(config, 'resolve');
  const resolve =
    resolveProperty && ts.isObjectLiteralExpression(resolveProperty.initializer) ? resolveProperty.initializer : null;
  return { file, config, resolve };
}

function arrayProperty(object: ts.ObjectLiteralExpression | null, key: string): ts.ArrayLiteralExpression | null {
  const property = object ? findProperty(object, key) : undefined;
  return property && ts.isArrayLiteralExpression(property.initializer) ? property.initializer : null;
}

/** The packages the config dedupes, or null when it has no plain `resolve.dedupe` list. */
export function readViteDedupe(content: string, fileName = 'vite.config.ts'): string[] | null {
  const shape = shapeOf(content, fileName);
  const dedupe = arrayProperty(shape?.resolve ?? null, 'dedupe');
  if (!dedupe) return null;
  return dedupe.elements.flatMap((element) => (ts.isStringLiteral(element) ? [element.text] : []));
}

const isEnvModuleCall = (element: ts.Expression, name?: string) =>
  ts.isCallExpression(element) &&
  ts.isIdentifier(element.expression) &&
  element.expression.text === 'envModule' &&
  (name === undefined || (element.arguments[0] !== undefined && ts.isStringLiteral(element.arguments[0]) && element.arguments[0].text === name));

export function patchViteConfig(content: string, change: ViteConfigChange, fileName = 'vite.config.ts'): PatchResult {
  const javascript = /\.[cm]?jsx?$/.test(fileName);
  const manual = [
    ...Object.entries(change.addAliases ?? {}).map(([name, target]) => `Add to resolve.alias: ${viteAliasEntry(name, target).code}`),
    ...(change.removeAliases ?? []).map((name) => `Remove the ${name} entry from resolve.alias.`),
    ...(change.addDedupe?.length ? [`Add to resolve.dedupe: ${change.addDedupe.map((name) => `'${name}'`).join(', ')}`] : []),
    ...(change.removeDedupe?.length ? [`Remove from resolve.dedupe: ${change.removeDedupe.map((name) => `'${name}'`).join(', ')}`] : []),
    ...Object.entries(change.addEnvModules ?? {}).map(([name, file]) => `Serve ${file} as '${name}' in plugins — see webScaffold.ts's envModule.`),
    ...(change.removeEnvModules ?? []).map((name) => `Remove the envModule('${name}', …) plugin.`),
  ].join('\n');

  const broken = brokenReason(content, fileName);
  if (broken) return refused(content, broken, manual);

  let current = content;
  const reshape = (): ViteShape | PatchResult => {
    const shape = shapeOf(current, fileName);
    return shape ?? refused(content, "web/vite.config doesn't pass an object to defineConfig", manual);
  };
  const failed = (shape: ViteShape | PatchResult): shape is PatchResult => 'changed' in shape;

  // ---- aliases ---------------------------------------------------------------------
  if (change.removeAliases?.length || Object.keys(change.addAliases ?? {}).length) {
    let shape = reshape();
    if (failed(shape)) return shape;
    let alias = arrayProperty(shape.resolve, 'alias');
    if (!alias) return refused(content, 'web/vite.config has no plain `resolve.alias` list', manual);
    const findOf = (element: ts.Expression) => {
      if (!ts.isObjectLiteralExpression(element)) return null;
      const find = findProperty(element, 'find');
      return find ? find.initializer.getText(element.getSourceFile()) : null;
    };

    const targets = (change.removeAliases ?? []).flatMap((name) => {
      const element = alias!.elements.find((entry) => findOf(entry) === viteAliasEntry(name, '').find);
      return element ? [{ name, element }] : [];
    });
    const removals: TextEdit[] = arrayElementRemoval(current, shape.file, alias, targets.map((target) => target.element));
    if (current.slice(alias.getStart(shape.file), alias.getEnd()).includes('\n')) {
      // One removal per target, in order: each also takes the comment armemon wrote above it.
      targets.forEach(({ name, element }, index) => {
        const { comment } = viteAliasEntry(name, '');
        const above = ts.getLeadingCommentRanges(current, element.getFullStart()) ?? [];
        const own = above.find((range) => current.slice(range.pos, range.end).startsWith(comment.slice(0, comment.indexOf('→'))));
        if (own) removals[index] = { ...removals[index]!, start: lineStartOf(current, own.pos) };
      });
    }
    current = applyEdits(current, removals);

    const additions = Object.entries(change.addAliases ?? {});
    if (additions.length > 0) {
      shape = reshape();
      if (failed(shape)) return shape;
      alias = arrayProperty(shape.resolve, 'alias')!;
      const present = new Set(alias.elements.map(findOf));
      const eol = eolOf(current);
      const last = alias.elements[alias.elements.length - 1];
      const indent = last ? indentAt(current, last.getStart(shape.file)) : '      ';
      // The explaining comment only on a list that has a line per entry: on one line,
      // a `//` would swallow whatever follows it.
      const multiline = current.slice(alias.getStart(shape.file), alias.getEnd()).includes('\n');
      const texts = additions
        .map(([name, target]) => viteAliasEntry(name, target))
        .filter((entry) => !present.has(entry.find))
        .map((entry) => (multiline ? `${entry.comment}${eol}${indent}${entry.code}` : entry.code));
      current = applyEdits(current, arrayElementInsertion(current, shape.file, alias, texts));
    }
  }

  // ---- dedupe ----------------------------------------------------------------------
  if (change.removeDedupe?.length || change.addDedupe?.length) {
    let shape = reshape();
    if (failed(shape)) return shape;
    let dedupe = arrayProperty(shape.resolve, 'dedupe');
    if (!dedupe) return refused(content, 'web/vite.config has no plain `resolve.dedupe` list', manual);
    const unwanted = new Set(change.removeDedupe ?? []);
    const targets = dedupe.elements.filter((element) => ts.isStringLiteral(element) && unwanted.has(element.text));
    current = applyEdits(current, arrayElementRemoval(current, shape.file, dedupe, targets));

    if (change.addDedupe?.length) {
      shape = reshape();
      if (failed(shape)) return shape;
      dedupe = arrayProperty(shape.resolve, 'dedupe')!;
      const present = new Set(dedupe.elements.flatMap((element) => (ts.isStringLiteral(element) ? [element.text] : [])));
      const missing = [...new Set(change.addDedupe)].filter((name) => !present.has(name)).map((name) => `'${name}'`);
      current = applyEdits(current, arrayElementInsertion(current, shape.file, dedupe, missing));
    }
  }

  // ---- env modules -----------------------------------------------------------------
  if (change.removeEnvModules?.length || Object.keys(change.addEnvModules ?? {}).length) {
    let shape = reshape();
    if (failed(shape)) return shape;
    let plugins = arrayProperty(shape.config, 'plugins');
    if (!plugins) return refused(content, 'web/vite.config has no plain `plugins` list', manual);

    const targets = plugins.elements.filter((element) =>
      (change.removeEnvModules ?? []).some((name) => isEnvModuleCall(element, name)),
    );
    current = applyEdits(current, arrayElementRemoval(current, shape.file, plugins, targets));

    const additions = Object.entries(change.addEnvModules ?? {});
    shape = reshape();
    if (failed(shape)) return shape;
    plugins = arrayProperty(shape.config, 'plugins')!;
    const helper = shape.file.statements.find(
      (statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) && statement.name?.text === 'envModule',
    );
    const missing = additions.filter(([name]) => !plugins!.elements.some((element) => isEnvModuleCall(element, name)));

    if (missing.length > 0) {
      const edits: TextEdit[] = arrayElementInsertion(
        current,
        shape.file,
        plugins,
        missing.map(([name, file]) => viteEnvModuleCall(name, file)),
      );
      if (!helper) {
        // The helper, and the imports it needs, as the generated config has them.
        const appRoot = shape.file.statements.find(
          (statement) =>
            ts.isVariableStatement(statement) &&
            statement.declarationList.declarations.some((declaration) => declaration.name.getText(shape.file) === 'appRoot'),
        );
        if (!appRoot) return refused(content, 'web/vite.config has no `const appRoot = …` to place the env helper after', manual);
        const eol = eolOf(current);
        const helperSource = javascript ? stripTypes(ENV_MODULE_PLUGIN, 'helper.ts').trim() : ENV_MODULE_PLUGIN.trim();
        edits.push(lineAfter(current, appRoot.getEnd(), '', `${eol}${helperSource.replace(/\n/g, eol)}`));

        const bindings = shape.file.statements.filter(ts.isImportDeclaration);
        const hasFs = bindings.some((declaration) => ts.isStringLiteral(declaration.moduleSpecifier) && /^(node:)?fs$/.test(declaration.moduleSpecifier.text));
        if (!hasFs) {
          const react = bindings.find((declaration) => ts.isStringLiteral(declaration.moduleSpecifier) && declaration.moduleSpecifier.text === '@vitejs/plugin-react');
          const anchor = react ?? bindings[bindings.length - 1];
          if (!anchor) return refused(content, 'web/vite.config has no imports to add to', manual);
          edits.push(lineAfter(current, anchor.getEnd(), '', `import fs from 'node:fs';`));
        }
        if (!javascript) {
          const pluginType = namedImportInsertion(current, shape.file, 'type Plugin', 'vite');
          if (pluginType) edits.push(pluginType);
        }
      }
      current = applyEdits(current, edits);
    } else if (targets.length > 0 && helper && !plugins.elements.some((element) => isEnvModuleCall(element))) {
      // The last env module went: so does the helper, and anything only it imported.
      const comments = ts.getLeadingCommentRanges(current, helper.getFullStart()) ?? [];
      const start = comments[0]?.pos ?? helper.getStart(shape.file);
      const removal = removalOf(current, start, helper.getEnd());
      // It was written with a blank line beside it; that one goes with it — the one
      // after when there is one, else the one before.
      let from = lineStartOf(current, start);
      let end = removal.end;
      const blankAfter = /^\r?\n/.exec(current.slice(end))?.[0];
      if (blankAfter) end += blankAfter.length;
      else if (/\n\r?\n$/.test(current.slice(0, from))) from -= current.slice(0, from).endsWith('\r\n') ? 2 : 1;
      current = applyEdits(current, [{ ...removal, start: from, end }]);

      for (const local of ['Plugin', 'fs']) {
        const file = parseSource(current, fileName);
        const unused = unusedImportRemoval(current, file, local);
        if (unused) current = applyEdits(current, [unused]);
      }
    }
  }

  return checked(content, current, fileName, manual, 'web/vite.config already has these entries');
}
