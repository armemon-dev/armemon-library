/**
 * FILE: arrayLiteralEdit.ts
 * PATH: packages/cli-kit/src/fs/arrayLiteralEdit.ts
 *
 * WHAT: Adds an element to, or removes one from, an array literal in source — keeping
 *       the array's own layout, indentation and trailing-comma habit.
 * WHY:  Most of what a plugin puts into shared files is a list entry: a plugin in
 *       runtime.generated's `plugins: [...]`, a Babel plugin, a folder Metro watches, a
 *       package Jest pins. Rewriting the whole file to change one entry loses whatever
 *       else the person put there, so `armemon plugin add/remove` edit the entry alone.
 * HOW:  Positions come from the TypeScript AST, so a comma inside a string or comment is
 *       never mistaken for a separator. A single-line array stays on one line; a
 *       multi-line one gets a new line indented like its neighbours.
 * WHEN: By the plugin add/remove appliers.
 *
 * EXPORTS: arrayElementInsertion, arrayElementRemoval, sameCode
 * DEPENDS ON: typescript, ./sourceEdit
 * USED BY: babelConfigPatcher.ts, runtimeGeneratedPatcher.ts, metroConfigPatcher.ts,
 *          jestSetupWriter.ts
 */

import ts from 'typescript';
import {
  blockInsertion,
  commaAfter,
  eolOf,
  indentAt,
  lineStartOf,
  removalOf,
  type TextEdit,
} from './sourceEdit.js';

/** Two pieces of code that differ only in whitespace and quote style. */
export function sameCode(a: string, b: string): boolean {
  const normal = (text: string) => text.replace(/\s+/g, '').replace(/"/g, "'").replace(/,(?=[\]}])/g, '');
  return normal(a) === normal(b);
}

/**
 * Inserts `texts` as new elements, in order, at `index` (default: the end).
 *
 * Several at once rather than one call each: two separate insertions after the same
 * last element would each add the comma that separates it from what follows.
 */
export function arrayElementInsertion(
  content: string,
  file: ts.SourceFile,
  array: ts.ArrayLiteralExpression,
  texts: string[],
  index = array.elements.length,
): TextEdit[] {
  if (texts.length === 0) return [];
  const eol = eolOf(content);
  const open = array.getStart(file);
  const close = array.getEnd() - 1;
  const elements = array.elements;
  const multiline = content.slice(open, close).includes('\n');

  if (elements.length === 0) {
    if (!multiline) return [{ start: open + 1, end: close, text: texts.join(', ') }];
    return [blockInsertion(content, open + 1, close, texts.join(`,${eol}${indentAt(content, open)}  `) + ',')];
  }

  const at = Math.max(0, Math.min(index, elements.length));

  if (!multiline) {
    if (at === 0) {
      const first = elements[0]!;
      return [{ start: first.getStart(file), end: first.getStart(file), text: `${texts.join(', ')}, ` }];
    }
    const previous = elements[at - 1]!;
    return [{ start: previous.getEnd(), end: previous.getEnd(), text: `, ${texts.join(', ')}` }];
  }

  if (at < elements.length) {
    const next = elements[at]!;
    const lineStart = lineStartOf(content, next.getStart(file));
    const indent = indentAt(content, next.getStart(file));
    return [{ start: lineStart, end: lineStart, text: texts.map((text) => `${indent}${text},${eol}`).join('') }];
  }

  const last = elements[elements.length - 1]!;
  const indent = indentAt(content, last.getStart(file));
  const trailing = elements.hasTrailingComma;
  const afterLast = trailing ? (commaAfter(content, last.getEnd()) ?? last.getEnd()) : last.getEnd();
  const newline = content.indexOf('\n', afterLast);
  const insertAt = newline === -1 ? content.length : newline + 1;
  const lines = texts.map((text, position) =>
    `${indent}${text}${trailing || position < texts.length - 1 ? ',' : ''}${eol}`,
  );
  const edits: TextEdit[] = [];
  if (!trailing) edits.push({ start: last.getEnd(), end: last.getEnd(), text: ',' });
  edits.push({ start: insertAt, end: insertAt, text: lines.join('') });
  return edits;
}

/**
 * Removes `targets` (elements of `array`) and the separators that went with them.
 *
 * All at once: on a single line, per-element removals overlap at the commas between
 * neighbours, so the remaining elements are written back instead.
 */
export function arrayElementRemoval(
  content: string,
  file: ts.SourceFile,
  array: ts.ArrayLiteralExpression,
  targets: ts.Expression[],
): TextEdit[] {
  if (targets.length === 0) return [];
  const open = array.getStart(file);
  const close = array.getEnd() - 1;
  const elements = [...array.elements];

  if (!content.slice(open, close).includes('\n')) {
    const remaining = elements.filter((element) => !targets.includes(element)).map((element) => element.getText(file));
    return [{ start: open + 1, end: close, text: remaining.join(', ') }];
  }

  // Multi-line: each element's own line goes, with its comma.
  const edits = targets.map((element) =>
    removalOf(content, element.getStart(file), element.getEnd(), { trailingComma: true }),
  );
  // A list written without a trailing comma keeps that habit: when its last element
  // goes, the comma on the element that is now last goes too.
  const remaining = elements.filter((element) => !targets.includes(element));
  const newLast = remaining[remaining.length - 1];
  if (!array.elements.hasTrailingComma && targets.includes(elements[elements.length - 1]!) && newLast) {
    const comma = commaAfter(content, newLast.getEnd());
    if (comma !== null) edits.push({ start: comma - 1, end: comma, text: '' });
  }
  return edits;
}
