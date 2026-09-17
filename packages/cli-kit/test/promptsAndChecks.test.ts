/**
 * FILE: promptsAndChecks.test.ts
 * PATH: packages/cli-kit/test/promptsAndChecks.test.ts
 *
 * WHAT: Two small pieces the screen commands lean on: validating a prompt's default
 *       when the answer is left empty, and reading which files tsc reported errors in.
 * WHY:  clack validates the typed value before it substitutes the default, so every
 *       interactive create-screen refused its own default deep-link path on Enter —
 *       no test saw it, because every test runs with --all-accept. And a failed
 *       type-check used to be blamed on the command that ran it, even when the errors
 *       were in files it never touched.
 */
import { describe, expect, it } from 'vitest';
import { typeCheckErrorFiles, validateWithDefault } from '../dist/index.js';

describe('validateWithDefault', () => {
  const required = (value: string) => (value === '' ? 'Required.' : undefined);

  it('validates the default when the answer is left empty', () => {
    expect(validateWithDefault(required, 'order')!('')).toBeUndefined();
    expect(validateWithDefault(required, 'order')!('invoice')).toBeUndefined();
  });

  it('still refuses an empty answer when there is no default', () => {
    expect(validateWithDefault(required, undefined)!('')).toBe('Required.');
    expect(validateWithDefault(undefined, 'order')).toBeUndefined();
  });
});

describe('typeCheckErrorFiles', () => {
  it('reads each file tsc reported an error in, once', () => {
    const output = [
      "src/screens/OrderScreen/index.tsx(3,5): error TS2304: Cannot find name 'x'.",
      "src/App.tsx(10,1): error TS1005: ';' expected.",
      "src/App.tsx(11,1): error TS1005: ';' expected.",
      'Found 3 errors in 2 files.',
    ].join('\n');
    expect(typeCheckErrorFiles(output)).toEqual(['src/screens/OrderScreen/index.tsx', 'src/App.tsx']);
    expect(typeCheckErrorFiles('npm ERR! could not determine executable to run')).toEqual([]);
  });
});
