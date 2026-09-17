/**
 * FILE: jsonMerge.ts
 * PATH: packages/cli-kit/src/fs/jsonMerge.ts
 *
 * WHAT: Merges a plugin's values into a JSON file the app already has, and takes them
 *       back out again — tsconfig.json's `@/*` path alias, say.
 * WHY:  A plugin that needs one key in tsconfig.json used to write the whole file, read
 *       from disk with its key added. That can be applied, but never reversed: nothing
 *       remembers which part was the plugin's, so `armemon plugin remove` left an alias
 *       behind that the type checker believed and Metro didn't — and `armemon doctor`
 *       rightly failed the app for it.
 * HOW:  Objects merge key by key; anything else (a string, an array) is a value set
 *       whole. Taking values out deletes each leaf that still holds the plugin's value,
 *       then any object that deletion left empty. A leaf someone changed stays. A file
 *       that isn't plain JSON — comments, trailing commas — is refused rather than
 *       rewritten without them.
 * WHEN: By init and the plugin add/remove appliers, for a plan's `jsonMerges`.
 *
 * EXPORTS: mergeJsonValues, unmergeJsonValues, subtractJsonValues
 * DEPENDS ON: node:path, ./patchResult
 * USED BY: packages/cli-armemon/src/flows/initReactNative.ts,
 *          packages/cli-armemon/src/flows/plugins/reconcile.ts
 */

import path from 'node:path';
import { done, refused, type PatchResult } from './patchResult.js';

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function parse(content: string, fileName: string, values: JsonObject): { value: JsonObject } | { refusal: PatchResult } {
  const manual = `Merge this into ${path.basename(fileName)} by hand:\n${JSON.stringify(values, null, 2)}`;
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!isObject(parsed)) return { refusal: refused(content, `${path.basename(fileName)} doesn't hold a JSON object`, manual) };
    return { value: parsed };
  } catch {
    return {
      refusal: refused(
        content,
        `${path.basename(fileName)} isn't plain JSON (comments or trailing commas), and writing it back would lose them`,
        manual,
      ),
    };
  }
}

const serialize = (value: JsonObject, original: string) => {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  return original.includes('\r\n') ? text.replace(/\n/g, '\r\n') : text;
};

function merge(target: JsonObject, values: JsonObject): void {
  for (const [key, value] of Object.entries(values)) {
    if (isObject(value) && isObject(target[key])) merge(target[key] as JsonObject, value);
    else target[key] = structuredClone(value);
  }
}

/** Removes each leaf still equal to `values`; returns whether anything went. */
function unmerge(target: JsonObject, values: JsonObject): boolean {
  let removed = false;
  for (const [key, value] of Object.entries(values)) {
    if (!(key in target)) continue;
    if (isObject(value) && isObject(target[key])) {
      const child = target[key] as JsonObject;
      if (unmerge(child, value)) {
        removed = true;
        if (Object.keys(child).length === 0) delete target[key];
      }
    } else if (sameValue(target[key], value)) {
      delete target[key];
      removed = true;
    }
  }
  return removed;
}

export function mergeJsonValues(content: string, values: JsonObject, fileName: string): PatchResult {
  const parsed = parse(content, fileName, values);
  if ('refusal' in parsed) return parsed.refusal;
  const next = structuredClone(parsed.value);
  merge(next, values);
  if (sameValue(next, parsed.value)) return done(content, `${path.basename(fileName)} already has these values`);
  return { content: serialize(next, content), changed: true };
}

export function unmergeJsonValues(content: string, values: JsonObject, fileName: string): PatchResult {
  const parsed = parse(content, fileName, values);
  if ('refusal' in parsed) return parsed.refusal;
  const next = structuredClone(parsed.value);
  if (!unmerge(next, values)) return done(content, `${path.basename(fileName)} no longer has these values`);
  return { content: serialize(next, content), changed: true };
}

/** `values` without the leaves `others` also sets — what is one plugin's alone. */
export function subtractJsonValues(values: JsonObject, others: JsonObject[]): JsonObject {
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(values)) {
    const theirs = others.filter((other) => key in other).map((other) => other[key]);
    if (isObject(value)) {
      const rest = subtractJsonValues(value, theirs.filter(isObject));
      if (Object.keys(rest).length > 0) out[key] = rest;
    } else if (!theirs.some((other) => sameValue(other, value))) {
      out[key] = value;
    }
  }
  return out;
}
