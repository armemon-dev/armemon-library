/**
 * FILE: storeConfigPatcher.ts
 * PATH: packages/cli-kit/src/fs/storeConfigPatcher.ts
 *
 * WHAT: Reads and edits the `slices` object in a generated store.config — adding,
 *       removing and listing the slices a Redux store is built from.
 * WHY:  Adding a slice by hand is two edits in one managed file: an import at the
 *       top and a line inside `slices: {}`. Doing one and forgetting the other is
 *       the single most common way a new slice silently isn't in the store — the app
 *       compiles, `state.cart` is undefined, and nothing says why.
 *
 *       Parser-backed rather than line-matched, for the same reasons the navigator
 *       patcher is: the file is full of commented-out examples that look exactly like
 *       real entries (`//   cart: cartSlice,`), and a regex cannot tell them apart.
 * HOW:  Finds `reduxConfig`'s object literal, then its `slices` property, and edits
 *       that. Every result goes through `checked`, so an edit that would leave the
 *       file unparsable is refused instead of written.
 * WHEN: `armemon create-slice`, `remove-slice` and `rename-slice`.
 *
 * EXPORTS: StoreSlice, storeSlices, addSliceToStore, removeSliceFromStore
 * DEPENDS ON: node:path, typescript, ./sourceEdit, ./patchResult
 * USED BY: packages/cli-armemon/src/flows/createSlice.ts
 */

import path from 'node:path';
import ts from 'typescript';
import {
  applyEdits,
  commentRanges,
  findProperty,
  identifierRenames,
  importBindings,
  keyText,
  namedImportInsertion,
  parseSource,
  propertyInsertion,
  propertyName,
  quoteString,
  removalOf,
  stringQuoteOf,
  unusedImportRemoval,
  type TextEdit,
} from './sourceEdit.js';
import { brokenReason, checked, done, finish, refused, type PatchResult } from './patchResult.js';

const DEFAULT_FILE = 'store.config.ts';

/** The `slices: { … }` object literal, wherever reduxConfig is declared. */
function slicesObject(file: ts.SourceFile): ts.ObjectLiteralExpression | null {
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'reduxConfig') continue;
      const initializer = declaration.initializer;
      if (!initializer || !ts.isObjectLiteralExpression(initializer)) continue;
      const slices = findProperty(initializer, 'slices');
      if (slices && ts.isObjectLiteralExpression(slices.initializer)) return slices.initializer;
    }
  }
  return null;
}

export interface StoreSlice {
  /** The key in state: `cart`. */
  stateKey: string;
  /** The binding it is set to, when it is a plain identifier: `cartSlice`. */
  binding: string | null;
  /** Where that binding is imported from, when it is imported. */
  module: string | null;
}

/** Every slice the store registers, in the order the file lists them. */
export function storeSlices(content: string, fileName = DEFAULT_FILE): StoreSlice[] {
  const file = parseSource(content, fileName);
  const slices = slicesObject(file);
  if (!slices) return [];

  const imports = importBindings(file);
  const found: StoreSlice[] = [];

  for (const property of slices.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const stateKey = propertyName(property.name);
    if (stateKey === null) continue;

    const binding = ts.isIdentifier(property.initializer) ? property.initializer.text : null;
    const module = binding ? (imports.find((entry) => entry.local === binding)?.module ?? null) : null;
    found.push({ stateKey, binding, module });
  }

  return found;
}

export interface AddSliceOptions {
  fileName?: string;
  /** The key in state, and in `slices: {}`. */
  stateKey: string;
  /** The exported binding to import and register. */
  exportName: string;
  /** The specifier the store config uses to reach the slice file. */
  from: string;
}

/**
 * Registers a slice: the named import, and its entry in `slices`.
 *
 * Both edits or neither. A store config carrying an import for a slice it doesn't
 * register is worse than one missing both, because it type-checks.
 */
export function addSliceToStore(content: string, options: AddSliceOptions): PatchResult {
  const fileName = options.fileName ?? DEFAULT_FILE;
  const { stateKey, exportName, from } = options;
  const manual = `import { ${exportName} } from '${from}';   // then add  ${stateKey}: ${exportName},  inside slices`;

  const broken = brokenReason(content, fileName);
  if (broken) return refused(content, broken, manual);

  const file = parseSource(content, fileName);
  const slices = slicesObject(file);
  if (!slices) {
    return refused(
      content,
      "couldn't find a `slices` object in reduxConfig",
      manual,
    );
  }

  const existing = findProperty(slices, stateKey);
  if (existing) {
    return done(content, `${stateKey} is already registered in the store`);
  }

  const edits: TextEdit[] = [];
  const importEdit = namedImportInsertion(content, file, exportName, from);
  if (importEdit) edits.push(importEdit);
  edits.push(...propertyInsertion(content, file, slices, stateKey, exportName));

  return finish(content, edits, fileName, manual);
}

/** The object a `export const <name> = { … }` config declares, by export name. */
function configObject(file: ts.SourceFile, exportName: string): ts.ObjectLiteralExpression | null {
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== exportName) continue;
      const initializer = declaration.initializer;
      if (initializer && ts.isObjectLiteralExpression(initializer)) return initializer;
    }
  }
  return null;
}

export interface SetConfigOptions {
  fileName?: string;
  /** The exported config object: `uiConfig`, `essentialsConfig`, `reduxConfig`. */
  exportName: string;
  /** A dotted path — `themeMode`, or `notifications.position`. */
  key: string;
  /** Rendered as-is: already-quoted strings, numbers, booleans, or raw code. */
  value: string;
  /**
   * Replace a value that isn't a literal. Off by default: these configs hold
   * functions (`middleware: (defaultMiddleware) => …`) and expressions (`__DEV__`),
   * and overwriting one with a scalar removes behaviour the user wrote by hand
   * without anything failing afterwards.
   */
  force?: boolean;
}

/**
 * Sets one property in a generated config, adding it if it isn't there.
 *
 * Dotted paths are followed rather than flattened: essentialsConfig groups its
 * options (`notifications.position`), so a setter that only reached top-level keys
 * would be useless for the config that needs it most. A missing intermediate object
 * is reported instead of invented — creating `notifications: {}` to hold one key
 * would silently drop every default the real object carries.
 */
export function setConfigProperty(content: string, options: SetConfigOptions): PatchResult {
  const fileName = options.fileName ?? 'config.ts';
  const { exportName, key, value } = options;
  const manual = `Set ${key} to ${value} in ${exportName}.`;

  const broken = brokenReason(content, fileName);
  if (broken) return refused(content, broken, manual);

  const file = parseSource(content, fileName);
  let object = configObject(file, exportName);
  if (!object) return refused(content, `couldn't find \`${exportName}\` in ${path.basename(fileName)}`, manual);

  const segments = key.split('.').filter(Boolean);
  const leaf = segments.pop();
  if (!leaf) return refused(content, 'no property was named', manual);

  for (const segment of segments) {
    const parent = findProperty(object, segment);
    if (!parent || !ts.isObjectLiteralExpression(parent.initializer)) {
      return refused(
        content,
        `${exportName} has no \`${segment}\` object to set \`${leaf}\` inside`,
        manual,
      );
    }
    object = parent.initializer;
  }

  const existing = findProperty(object, leaf);
  if (!existing) {
    return finish(content, propertyInsertion(content, file, object, leaf, value), fileName, manual);
  }

  const current = existing.initializer;
  if (current.getText(file) === value) {
    return done(content, `${key} is already ${value}`);
  }

  // A function or arrow here is configuration someone wrote, not a value to clobber.
  const isCode =
    ts.isArrowFunction(current) || ts.isFunctionExpression(current) || ts.isCallExpression(current);
  if (isCode && !options.force) {
    return refused(
      content,
      `${key} is set to code, not a value (${current.getText(file).split('\n')[0]?.trim()})`,
      `${manual} Pass --force to replace it anyway.`,
      true,
    );
  }

  return finish(
    content,
    [{ start: current.getStart(file), end: current.getEnd(), text: value }],
    fileName,
    manual,
  );
}

export interface RenameSliceDeclarationOptions {
  fileName?: string;
  /** The exported binding today: `cartSlice`. */
  fromExport: string;
  toExport: string;
  /** The `name` field, which is also the action-type prefix: `cart`. */
  from: string;
  to: string;
}

/** The object a slice is defined by, whether written plainly or via createSlice(). */
function sliceDefinition(
  file: ts.SourceFile,
  exportName: string,
): ts.ObjectLiteralExpression | null {
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== exportName) continue;
      const initializer = declaration.initializer;
      if (!initializer) continue;
      if (ts.isObjectLiteralExpression(initializer)) return initializer;
      // createSlice({ name: 'cart', … })
      if (ts.isCallExpression(initializer)) {
        const argument = initializer.arguments[0];
        if (argument && ts.isObjectLiteralExpression(argument)) return argument;
      }
    }
  }
  return null;
}

/**
 * Renames the slice inside its own file: the binding, and the `name` field.
 *
 * The `name` field is not decoration — Redux Toolkit builds every action type from
 * it, so `name: 'cart'` is what makes the action `cart/set`. A rename that changed
 * the binding and left the name would move `state.cart` to `state.basket` while every
 * action kept the old prefix: half-renamed, and nothing would say so.
 *
 * Comments are rewritten too, within comment ranges only. The generated slice header
 * names its own file and shows `dispatch({ type: 'cart/set' })`, and prose that
 * contradicts the code under it is worse than no prose.
 */
export function renameSliceDeclaration(
  content: string,
  options: RenameSliceDeclarationOptions,
): PatchResult {
  const fileName = options.fileName ?? 'slice.ts';
  const { fromExport, toExport, from, to } = options;
  const manual = `Rename ${fromExport} to ${toExport} and its \`name\` field to '${to}'.`;

  const broken = brokenReason(content, fileName);
  if (broken) return refused(content, broken, manual);

  const file = parseSource(content, fileName);
  const edits = identifierRenames(file, fromExport, toExport);

  const definition = sliceDefinition(file, fromExport);
  const nameProperty = definition ? findProperty(definition, 'name') : undefined;
  const nameValue = nameProperty?.initializer;
  if (nameValue && ts.isStringLiteral(nameValue) && nameValue.text === from) {
    edits.push({
      start: nameValue.getStart(file),
      end: nameValue.getEnd(),
      text: quoteString(to, stringQuoteOf(file)),
    });
  }

  // `\bcart\b` does not match inside `cartSlice` — the S is a word character — so the
  // two patterns cannot both fire on the same text.
  for (const [start, end] of commentRanges(file)) {
    const text = content.slice(start, end);
    for (const [word, replacement] of [
      [fromExport, toExport],
      [from, to],
    ] as const) {
      const pattern = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
      for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
        edits.push({
          start: start + match.index,
          end: start + match.index + word.length,
          text: replacement,
        });
      }
    }
  }

  return finish(content, edits, fileName, manual);
}

export interface RenameSliceImportOptions {
  fileName?: string;
  /** The binding as it is imported today: `cartSlice`. */
  fromExport: string;
  /** What it becomes: `basketSlice`. */
  toExport: string;
  /** The specifier the slice moves to, from this file. */
  toModule: string;
}

/**
 * The binding and the import path, in any file that uses the slice.
 *
 * `renameImportedName` is not optional here. Without it identifierRenames writes
 * `import { cartSlice as basketSlice }`, which aliases a name that is about to stop
 * existing — the slice file's own export is being renamed in the same run.
 */
function renameEdits(
  content: string,
  file: ts.SourceFile,
  options: RenameSliceImportOptions,
): TextEdit[] {
  const edits = identifierRenames(file, options.fromExport, options.toExport, {
    renameImportedName: true,
  });

  const binding = importBindings(file).find((entry) => entry.local === options.fromExport);
  const specifier = binding?.declaration.moduleSpecifier;
  if (specifier && ts.isStringLiteral(specifier) && specifier.text !== options.toModule) {
    edits.push({
      start: specifier.getStart(file),
      end: specifier.getEnd(),
      text: quoteString(options.toModule, stringQuoteOf(file)),
    });
  }

  return edits;
}

/** Follows a renamed slice through a file that imports it. */
export function renameSliceImport(content: string, options: RenameSliceImportOptions): PatchResult {
  const fileName = options.fileName ?? DEFAULT_FILE;
  const manual = `Rename ${options.fromExport} to ${options.toExport}, and import it from '${options.toModule}'.`;

  const broken = brokenReason(content, fileName);
  if (broken) return refused(content, broken, manual);

  const file = parseSource(content, fileName);
  return finish(content, renameEdits(content, file, options), fileName, manual);
}

export interface RenameSliceOptions extends RenameSliceImportOptions {
  /** The key in state today: `cart`. */
  from: string;
  /** What that key becomes: `basket`. */
  to: string;
}

/**
 * Renames a slice in the store config: the key in `slices`, the binding, the import.
 *
 * The key is edited separately because identifierRenames deliberately skips
 * property-assignment names — renaming `cart:` is a different decision from renaming
 * every `cart` in the file, and only one of them is wanted.
 */
export function renameSliceInStore(content: string, options: RenameSliceOptions): PatchResult {
  const fileName = options.fileName ?? DEFAULT_FILE;
  const { from, to } = options;
  const manual = `Rename ${from} to ${to} in the slices object, and its import.`;

  const broken = brokenReason(content, fileName);
  if (broken) return refused(content, broken, manual);

  const file = parseSource(content, fileName);
  const slices = slicesObject(file);
  const entry = slices ? findProperty(slices, from) : undefined;
  if (!slices || !entry) return done(content, `${from} is not registered in the store`);

  if (findProperty(slices, to)) {
    return refused(content, `${to} is already registered in the store`, manual, true);
  }

  const edits = renameEdits(content, file, options);
  edits.push({
    start: entry.name.getStart(file),
    end: entry.name.getEnd(),
    text: keyText(to, stringQuoteOf(file)),
  });

  return finish(content, edits, fileName, manual);
}

export interface RemoveSliceOptions {
  fileName?: string;
  stateKey: string;
}

/** Unregisters a slice, and drops its import when nothing else uses it. */
export function removeSliceFromStore(content: string, options: RemoveSliceOptions): PatchResult {
  const fileName = options.fileName ?? DEFAULT_FILE;
  const { stateKey } = options;
  const manual = `Remove ${stateKey} from the slices object, and its import.`;

  const broken = brokenReason(content, fileName);
  if (broken) return refused(content, broken, manual);

  const file = parseSource(content, fileName);
  const slices = slicesObject(file);
  const entry = slices ? findProperty(slices, stateKey) : undefined;
  if (!entry) return done(content, `${stateKey} is not registered in the store`);

  const binding = ts.isIdentifier(entry.initializer) ? entry.initializer.text : null;

  // Two passes, the same way unregisterScreenFromNavigator drops a screen and its
  // import. Whether the import is still needed can only be answered once the entry
  // using it is gone — asked of the file as it stands, the answer is always "still
  // used", and the import gets left behind pointing at a file that is about to be
  // deleted. Re-parsing in between also means any OTHER use of the binding anywhere
  // in the file keeps the import, without this having to look for them.
  let next = applyEdits(content, [
    removalOf(content, entry.getStart(file), entry.getEnd(), { trailingComma: true }),
  ]);

  if (binding) {
    const importEdit = unusedImportRemoval(next, parseSource(next, fileName), binding);
    if (importEdit) next = applyEdits(next, [importEdit]);
  }

  return checked(content, next, fileName, manual);
}
