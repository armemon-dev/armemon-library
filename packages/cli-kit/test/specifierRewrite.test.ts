/**
 * FILE: specifierRewrite.test.ts
 * PATH: packages/cli-kit/test/specifierRewrite.test.ts
 *
 * WHAT: Rewriting relative import specifiers when a folder moves.
 * WHY:  This is what `armemon sync` runs across an entire existing project to move a
 *       legacy src/armemon/ up to armemon/, and a mistake here corrupts every import
 *       it touches at once. The tempting implementation — "add one ../ to anything
 *       mentioning armemon" — is wrong in both directions: specifiers that move WITH
 *       the folder must not change at all, and specifiers pointing INTO the folder
 *       from outside change by a different amount than ones pointing out of it.
 *
 *       So these cases are the real migration in miniature: a file inside the moving
 *       tree reaching out, a file in src/ reaching in, the App entry at the app root,
 *       and a sibling import that has to stay exactly as it was.
 * HOW:  Real files in a temp directory, because resolution reads the disk.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readPathAliases, resolveRelativeModule, rewriteModuleSpecifiers } from '../dist/index.js';

const made: string[] = [];

afterEach(async () => {
  await Promise.all(made.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

/** A legacy app: managed files under src/armemon/, about to move to armemon/. */
async function legacyApp(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'armemon-move-'));
  made.push(root);
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, 'utf8');
  }
  return root;
}

const APP = {
  'src/armemon/navigation/RootNavigator.tsx':
    "import type { RootStackParamList } from './types';\n" +
    "import HomeScreen from '../../screens/HomeScreen';\n" +
    "import { View } from 'react-native';\n" +
    "// mentions '../../screens/HomeScreen' in prose\n",
  'src/armemon/navigation/types.ts': 'export type RootStackParamList = { Home: undefined };\n',
  'src/armemon/runtime.generated.ts': "export const x = 1;\n",
  'src/screens/HomeScreen/index.tsx':
    "import type { RootStackParamList } from '../../armemon/navigation/types';\n" +
    "export default function HomeScreen() { return null; }\n",
  'App.tsx': "import './src/armemon/runtime.generated';\n",
};

/**
 * Rewrites one file for the src/armemon/ -> armemon/ move.
 *
 * `fromFile` and `toFile` differ only for files that are themselves moving; for
 * everything else the file stays put and only its targets move.
 */
async function moveManaged(
  root: string,
  fileRelative: string,
  extra: { aliases?: Array<{ prefix: string; target: string }>; watchSegment?: string } = {},
) {
  const oldRoot = path.join(root, 'src', 'armemon');
  const newRoot = path.join(root, 'armemon');

  const moving = fileRelative.startsWith('src/armemon/');
  const fromFile = path.join(root, fileRelative);
  const toFile = moving
    ? path.join(newRoot, path.relative(oldRoot, fromFile))
    : fromFile;

  return rewriteModuleSpecifiers(await fs.readFile(fromFile, 'utf8'), {
    fromFile,
    toFile,
    resolve: resolveRelativeModule,
    relocate: (module) =>
      module === oldRoot || module.startsWith(`${oldRoot}${path.sep}`)
        ? path.join(newRoot, path.relative(oldRoot, module))
        : module,
    ...extra,
  });
}

describe('rewriteModuleSpecifiers, moving src/armemon/ to armemon/', () => {
  it('lengthens a reach out of the moving folder, and leaves a sibling alone', async () => {
    const root = await legacyApp(APP);
    const { content, changed } = await moveManaged(root, 'src/armemon/navigation/RootNavigator.tsx');

    expect(changed).toBe(true);
    // Out of the managed zone: one level deeper now that armemon/ is not inside src/.
    expect(content).toContain("import HomeScreen from '../../src/screens/HomeScreen';");
    // Moves with the file, so it must be untouched.
    expect(content).toContain("import type { RootStackParamList } from './types';");
  });

  it('lengthens a reach into the moving folder from a file that stays put', async () => {
    const root = await legacyApp(APP);
    const { content } = await moveManaged(root, 'src/screens/HomeScreen/index.tsx');

    expect(content).toContain(
      "import type { RootStackParamList } from '../../../armemon/navigation/types';",
    );
  });

  it('shortens the App entry at the app root', async () => {
    const root = await legacyApp(APP);
    const { content } = await moveManaged(root, 'App.tsx');

    expect(content).toContain("import './armemon/runtime.generated';");
  });

  it('never touches a package import', async () => {
    const root = await legacyApp(APP);
    const { content } = await moveManaged(root, 'src/armemon/navigation/RootNavigator.tsx');

    expect(content).toContain("import { View } from 'react-native';");
  });

  it('only edits real import statements, not a matching string in a comment', async () => {
    const root = await legacyApp(APP);
    const { content } = await moveManaged(root, 'src/armemon/navigation/RootNavigator.tsx');

    expect(content).toContain("// mentions '../../screens/HomeScreen' in prose");
  });

  it('reports a specifier it cannot resolve instead of guessing at it', async () => {
    const root = await legacyApp({
      ...APP,
      'src/armemon/navigation/RootNavigator.tsx': "import x from '../../nowhere/Missing';\n",
    });
    const { content, changed, unresolved } = await moveManaged(
      root,
      'src/armemon/navigation/RootNavigator.tsx',
    );

    expect(unresolved).toEqual(['../../nowhere/Missing']);
    expect(changed).toBe(false);
    expect(content).toContain("import x from '../../nowhere/Missing';");
  });

  it("keeps the file's own quote style", async () => {
    const root = await legacyApp({
      ...APP,
      'src/armemon/navigation/RootNavigator.tsx':
        'import HomeScreen from "../../screens/HomeScreen";\n',
    });
    const { content } = await moveManaged(root, 'src/armemon/navigation/RootNavigator.tsx');

    expect(content).toContain('import HomeScreen from "../../src/screens/HomeScreen";');
  });

  it('rewrites a re-export the same way as an import', async () => {
    const root = await legacyApp({
      ...APP,
      'src/armemon/navigation/RootNavigator.tsx':
        "export { default as HomeScreen } from '../../screens/HomeScreen';\n",
    });
    const { content } = await moveManaged(root, 'src/armemon/navigation/RootNavigator.tsx');

    expect(content).toContain(
      "export { default as HomeScreen } from '../../src/screens/HomeScreen';",
    );
  });

  // A module path isn't only written in an import statement. A test that mocks a
  // managed module by path broke on the move exactly as an import would have.
  it.each([
    ['require()', "const types = require('../../armemon/navigation/types');"],
    ['a dynamic import()', "const types = await import('../../armemon/navigation/types');"],
    ['jest.mock()', "jest.mock('../../armemon/navigation/types');"],
    ['jest.requireActual()', "const actual = jest.requireActual('../../armemon/navigation/types');"],
    ['vi.mock()', "vi.mock('../../armemon/navigation/types', () => ({}));"],
    ['an import-equals', "import types = require('../../armemon/navigation/types');"],
    ['an import() type', "type Types = typeof import('../../armemon/navigation/types');"],
  ])('rewrites the path in %s', async (_label, line) => {
    const root = await legacyApp({ ...APP, 'src/screens/HomeScreen/index.tsx': `${line}\n` });
    const { content } = await moveManaged(root, 'src/screens/HomeScreen/index.tsx');
    expect(content).toContain("'../../../armemon/navigation/types'");
  });

  it('leaves a call that only looks like one alone', async () => {
    const line = "logger.mock('../../armemon/navigation/types');";
    const root = await legacyApp({ ...APP, 'src/screens/HomeScreen/index.tsx': `${line}\n` });
    const { content } = await moveManaged(root, 'src/screens/HomeScreen/index.tsx');
    expect(content).toContain(line);
  });

  describe('through a path alias', () => {
    const aliasFor = (root: string) => [{ prefix: '@/', target: path.join(root, 'src') }];

    // `@/` means src/, and the managed zone is leaving src/ — so the alias can no
    // longer reach it and the import has to become relative.
    it('becomes relative when the module moves out from under the alias', async () => {
      const root = await legacyApp({
        ...APP,
        'src/screens/HomeScreen/index.tsx': "import type { RootStackParamList } from '@/armemon/navigation/types';\n",
      });
      const { content } = await moveManaged(root, 'src/screens/HomeScreen/index.tsx', { aliases: aliasFor(root) });
      expect(content).toContain("from '../../../armemon/navigation/types'");
    });

    it('stays an alias when its module is not moving', async () => {
      const root = await legacyApp({
        ...APP,
        'src/armemon/navigation/RootNavigator.tsx': "import HomeScreen from '@/screens/HomeScreen';\n",
      });
      const { content, changed } = await moveManaged(root, 'src/armemon/navigation/RootNavigator.tsx', {
        aliases: aliasFor(root),
      });
      expect(changed).toBe(false);
      expect(content).toContain("from '@/screens/HomeScreen'");
    });

    it('reports an alias armemon does not know that names the moving folder', async () => {
      const root = await legacyApp({
        ...APP,
        'src/screens/HomeScreen/index.tsx': "import types from '~/armemon/navigation/types';\nimport x from '@armemon-library/core';\n",
      });
      const { unresolved, changed } = await moveManaged(root, 'src/screens/HomeScreen/index.tsx', {
        aliases: aliasFor(root),
        watchSegment: 'armemon',
      });
      expect(unresolved).toEqual(['~/armemon/navigation/types']);
      expect(changed).toBe(false);
    });
  });
});

describe('readPathAliases', () => {
  it('reads wildcard paths from a tsconfig with comments and trailing commas', async () => {
    const root = await legacyApp({
      'tsconfig.json': '{\n  // React Native\'s config, plus aliases\n  "compilerOptions": {\n    "paths": { "@/*": ["./src/*"], "exact": ["./src/exact.ts"], },\n  },\n}\n',
    });
    expect(readPathAliases(root)).toEqual([{ prefix: '@/', target: path.join(root, 'src') }]);
  });
});
