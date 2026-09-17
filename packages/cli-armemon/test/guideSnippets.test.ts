/**
 * FILE: guideSnippets.test.ts
 * PATH: packages/cli-armemon/test/guideSnippets.test.ts
 *
 * WHAT: Compiles every code block in the in-app guide against the real packages.
 * WHY:  The guide's readers are beginners who paste what it says. A wrong prop or a
 *       missing required field is a red squiggle on their first day — and proof-reading
 *       does not catch it. This did: the guide told people to write
 *       `configureEssentialsPlugin({ network: { enabled: false } })`, which works at
 *       runtime and was a type error, because the options type was shallower than the
 *       merge it described.
 * HOW:  Each ```ts / ```tsx block becomes a file. A block starting with `// App.tsx`
 *       is written as that file, so the guide's own imports (`import './armemon.setup'`)
 *       resolve the way they would in a real app; a repeated name gets a suffix instead
 *       of silently overwriting the block before it. The files sit inside
 *       plugin-navigation, whose node_modules holds @react-navigation/native, and tsc
 *       runs once over all of them.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, managedReadme } from '@armemon-library/cli-kit';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

describe('the code in the guide', () => {
  it('type-checks exactly as written', async () => {
    const guide = managedReadme(DEFAULT_LAYOUT);
    const blocks = [...guide.matchAll(/```(?:tsx?|ts)\n([\s\S]*?)```/g)].map((match) => match[1]!);
    expect(blocks.length).toBeGreaterThan(5);

    const dir = path.join(ROOT, 'packages/plugin-navigation', `.guide-check-${process.pid}-${Date.now()}`);
    await fs.mkdir(dir, { recursive: true });

    try {
      const used = new Set<string>();
      let unnamed = 0;

      for (const block of blocks) {
        const named = /^\/\/ (\S+\.tsx?)\n/.exec(block)?.[1];
        let file = named ?? `snippet-${(unnamed += 1)}.tsx`;
        // Two blocks can describe the same file (Step 2, and the variant without the
        // network check). Both have to be compiled, so neither may replace the other.
        for (let n = 2; used.has(file); n += 1) {
          file = file.replace(/(\.tsx?)$/, `.${n}$1`);
        }
        used.add(file);
        await fs.writeFile(path.join(dir, file), block);
      }

      // What an armemon app already has: a screen to import, and the route list
      // React Navigation types navigate() against.
      await fs.mkdir(path.join(dir, 'src/screens/HomeScreen'), { recursive: true });
      await fs.writeFile(
        path.join(dir, 'src/screens/HomeScreen/index.tsx'),
        'export default function HomeScreen() { return null; }\n',
      );
      await fs.writeFile(
        path.join(dir, 'globals.d.ts'),
        'export {};\ndeclare global {\n  namespace ReactNavigation {\n    interface RootParamList { Home: undefined; Profile: undefined }\n  }\n}\n',
      );
      await fs.writeFile(
        path.join(dir, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            strict: true,
            noEmit: true,
            jsx: 'react-jsx',
            module: 'ESNext',
            moduleResolution: 'Bundler',
            target: 'ES2022',
            skipLibCheck: true,
            esModuleInterop: true,
            types: [],
          },
          include: ['**/*.ts', '**/*.tsx'],
        }),
      );

      const tsc = spawnSync(process.execPath, [path.join(ROOT, 'node_modules/typescript/bin/tsc'), '-p', dir], {
        encoding: 'utf8',
      });
      const output = `${tsc.stdout}${tsc.stderr}`.trim();

      expect(output, output).toBe('');
      expect(tsc.status).toBe(0);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
