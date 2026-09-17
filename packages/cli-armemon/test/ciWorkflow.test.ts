/**
 * FILE: ciWorkflow.test.ts
 * PATH: packages/cli-armemon/test/ciWorkflow.test.ts
 *
 * WHAT: The CI scaffold matrix runs every configuration it lists.
 * WHY:  Each configuration was an `include` entry on a matrix whose only dimension
 *       was the React Native version. GitHub merges an include into every job it
 *       doesn't conflict with, and a later include may overwrite what an earlier one
 *       added — so all nine collapsed into the last, and CI scaffolded
 *       splash-with-logo twice while looking like it tested nine setups. Nothing
 *       fails when that happens, so it is checked here.
 * HOW:  Reads the workflow as text — the shape being checked is small and fixed, and
 *       a YAML parser would be a dependency for one assertion.
 */
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WORKFLOW = fileURLToPath(new URL('../../../.github/workflows/ci.yml', import.meta.url));

describe('the CI scaffold matrix', () => {
  it('lists every configuration as a dimension, so none overwrites another', async () => {
    const text = await fs.readFile(WORKFLOW, 'utf8');
    const matrix = text.slice(text.indexOf('      matrix:'), text.indexOf('    steps:', text.indexOf('      matrix:')));

    const dimension = /^ {8}name:\n((?: {10}- .+\n)+)/m.exec(matrix)?.[1];
    expect(dimension, 'matrix.name must be a list of its own').toBeDefined();
    const names = [...dimension!.matchAll(/- (\S+)/g)].map((match) => match[1]);

    const included = [...matrix.matchAll(/^ {10}- name: (\S+)$/gm)].map((match) => match[1]);
    expect(included.length).toBeGreaterThan(0);
    expect([...names].sort()).toEqual([...included].sort());
  });
});
