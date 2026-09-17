/**
 * FILE: webContributions.test.ts
 * PATH: packages/cli-kit/test/webContributions.test.ts
 *
 * WHAT: What plugins contribute to the web target's Vite config really builds —
 *       checked by loading the generated config with Vite itself and bundling code
 *       that uses it.
 * WHY:  advanced-init's two default features, `@/` imports and `import { API_URL }
 *       from '@env'`, work through Babel. Metro runs the app's babel.config.js and
 *       Vite's React plugin doesn't, so both built on iOS and Android and failed
 *       `vite build`. Reading the generated text can't show that; only a build can.
 * HOW:  A throwaway app with the generated vite.config (TypeScript, and converted to
 *       JavaScript), this repo's own Vite, and one-line stand-ins for the two packages
 *       that config imports but the monorepo doesn't install. The config's own React
 *       plugin is irrelevant to what's under test, so its stand-in does nothing.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildWebScaffoldPlan, convertFilesToJavaScript } from '../dist/index.js';

const requireHere = createRequire(import.meta.url);
const VITE_DIR = path.dirname(requireHere.resolve('vite/package.json'));
const TYPES_DIR = path.join(path.dirname(requireHere.resolve('typescript/package.json')), '..', '@types');

let app: string;
let originalCwd: string;

const write = async (relative: string, content: string) => {
  const target = path.join(app, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, 'utf8');
};

beforeEach(async () => {
  app = await fs.mkdtemp(path.join(os.tmpdir(), 'armemon-web-'));
  originalCwd = process.cwd();

  await fs.mkdir(path.join(app, 'node_modules', '@vitejs'), { recursive: true });
  await fs.symlink(VITE_DIR, path.join(app, 'node_modules', 'vite'), 'dir');
  // Both module formats, like the real package: a React Native app has no
  // "type": "module", so Vite bundles its config as CommonJS and requires this.
  await write(
    'node_modules/@vitejs/plugin-react/package.json',
    JSON.stringify({
      name: '@vitejs/plugin-react',
      main: 'index.cjs',
      types: 'index.d.ts',
      exports: { '.': { types: './index.d.ts', import: './index.mjs', require: './index.cjs' } },
    }),
  );
  await write('node_modules/@vitejs/plugin-react/index.mjs', "export default () => ({ name: 'react-stand-in' });\n");
  await write(
    'node_modules/@vitejs/plugin-react/index.cjs',
    "const react = () => ({ name: 'react-stand-in' });\nmodule.exports = react;\nmodule.exports.default = react;\n",
  );
  await write(
    'node_modules/@vitejs/plugin-react/index.d.ts',
    "import type { Plugin } from 'vite';\nexport default function react(): Plugin;\n",
  );
  await write('node_modules/react-native-web/package.json', JSON.stringify({ name: 'react-native-web', main: 'index.js' }));
  await write('node_modules/react-native-web/index.js', 'module.exports = {};\n');

  await write('src/greeting.ts', "export const greeting = 'hello from src';\n");
  await write(
    '.env',
    [
      '# a comment line',
      'API_URL=https://api.example.test',
      'QUOTED="keeps # inside quotes"',
      'PLAIN=plain-value # a trailing comment',
      '',
    ].join('\n'),
  );
  await write('web/index.html', '<!doctype html><div id="root"></div><script type="module" src="./main.ts"></script>\n');
  await write(
    'web/main.ts',
    [
      "import { greeting } from '@/greeting';",
      "import { API_URL, QUOTED, PLAIN } from '@env';",
      'console.log([greeting, API_URL, QUOTED, PLAIN].join("|"));',
      '',
    ].join('\n'),
  );

  // The generated config resolves react-native-web from where Vite runs: the app root.
  process.chdir(app);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await fs.rm(app, { recursive: true, force: true });
});

const contributions = [{ aliases: { '@': 'src' } }, { envModules: { '@env': '.env' } }];

async function bundle(configFile: string): Promise<string> {
  const vite = (await import(requireHere.resolve('vite'))) as typeof import('vite');
  const loaded = await vite.loadConfigFromFile(
    { command: 'build', mode: 'production' },
    path.join(app, configFile),
    app,
    'silent',
  );
  expect(loaded).not.toBeNull();

  const output = (await vite.build({
    ...loaded!.config,
    configFile: false,
    logLevel: 'silent',
    build: { ...loaded!.config.build, write: false, minify: false },
  })) as { output: { type: string; code?: string }[] };

  return output.output
    .filter((entry) => entry.type === 'chunk')
    .map((entry) => entry.code ?? '')
    .join('\n');
}

describe('web contributions from plugins', () => {
  it.each(['typescript', 'javascript'] as const)(
    'resolve @/ imports and serve @env from the env file, in a %s app',
    async (language) => {
      const plan = buildWebScaffoldPlan('18.3.1', ['react'], contributions);
      const files =
        language === 'javascript' ? (await convertFilesToJavaScript(plan.filesToWrite)).files : plan.filesToWrite;
      const config = files.find((file) => /web\/vite\.config\.[jt]s$/.test(file.path))!;
      await write(config.path, config.content);

      const code = await bundle(config.path);

      expect(code).toContain('hello from src');
      expect(code).toContain('https://api.example.test');
      expect(code).toContain('keeps # inside quotes');
      expect(code).toContain('plain-value');
      expect(code).not.toContain('a trailing comment');
    },
    60_000,
  );

  it('never exposes the rest of process.env through the env module', async () => {
    process.env.ARMEMON_TEST_SECRET = 'must-not-ship';
    try {
      await write('web/main.ts', "import * as env from '@env';\nconsole.log(JSON.stringify(env));\n");
      const plan = buildWebScaffoldPlan('18.3.1', [], contributions);
      const config = plan.filesToWrite.find((file) => file.path === 'web/vite.config.ts')!;
      await write(config.path, config.content);

      expect(await bundle(config.path)).not.toContain('must-not-ship');
    } finally {
      delete process.env.ARMEMON_TEST_SECRET;
    }
  }, 60_000);

  it('leaves scoped packages alone: the @ alias matches @/ only', () => {
    const plan = buildWebScaffoldPlan('18.3.1', [], contributions);
    const config = plan.filesToWrite.find((file) => file.path === 'web/vite.config.ts')!.content;
    const source = /find: \/(\^@[^/]*?\(\?=\\\/\|\$\))\//.exec(config)?.[1];
    expect(source).toBeDefined();

    const find = new RegExp(source!);
    expect(find.test('@/components/Button')).toBe(true);
    expect(find.test('@')).toBe(true);
    expect(find.test('@react-navigation/native')).toBe(false);
  });

  it('type-checks, under strict settings', async () => {
    const plan = buildWebScaffoldPlan('18.3.1', [], contributions);
    const config = plan.filesToWrite.find((file) => file.path === 'web/vite.config.ts')!;
    await write(config.path, config.content);

    const program = ts.createProgram([path.join(app, config.path)], {
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      esModuleInterop: true,
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      types: ['node'],
      typeRoots: [TYPES_DIR],
    });
    const errors = ts
      .getPreEmitDiagnostics(program)
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '));
    expect(errors).toEqual([]);
  });

  it('adds nothing to a config no plugin contributed to', () => {
    const config = buildWebScaffoldPlan('18.3.1').filesToWrite.find((file) => file.path === 'web/vite.config.ts')!.content;
    expect(config).not.toContain('envModule');
    expect(config).not.toContain("import fs from 'node:fs'");
    expect(config).toContain('plugins: [react()]');
  });
});
