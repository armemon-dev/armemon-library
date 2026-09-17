/**
 * TypeScript-to-JavaScript conversion.
 *
 * React Native has shipped no JavaScript template since 0.71, so a JS app is
 * something armemon produces rather than something the RN CLI can be asked for.
 * Every generator authors TypeScript and the conversion happens once at the write
 * boundary — these tests pin that contract, because the failure mode is a .jsx file
 * full of TypeScript that only breaks in the user's build.
 */
import { describe, expect, it } from 'vitest';
import {
  activeCodeOf,
  stripTypes,
  javaScriptPathFor,
  isTypeOnlyModule,
  convertFilesToJavaScript,
  javaScriptSyntaxErrors,
  buildAppTestSource,
  buildWebScaffoldPlan,
  serializeAppConfig,
  appConfigFileName,
  generateUserRuntimeConfigSource,
} from '../dist/index.js';

describe('javaScriptPathFor', () => {
  it.each([
    ['src/a.ts', 'src/a.js'],
    ['src/a.tsx', 'src/a.jsx'],
    ['src/types/env.d.ts', 'src/types/env.js'],
    ['index.html', 'index.html'],
    ['babel.config.js', 'babel.config.js'],
  ])('%s -> %s', (input, expected) => {
    expect(javaScriptPathFor(input)).toBe(expected);
  });
});

describe('stripTypes', () => {
  const source = `import React from 'react';
import type { Foo } from './foo';
import { View } from 'react-native';

export interface Props { name: string }
type Alias = Props | null;

export default function Screen({ nav }: { nav: Foo }) {
  const x: Alias = null;
  return <View>{String(x)}</View>;
}

declare global {
  namespace ReactNavigation { interface RootParamList { Home: undefined } }
}
`;

  const out = stripTypes(source, 'Screen.tsx');

  it('removes type-only imports, interfaces, aliases and declare global', () => {
    expect(out).not.toContain('import type');
    expect(out).not.toContain('interface Props');
    expect(out).not.toContain('type Alias');
    expect(out).not.toContain('declare global');
  });

  it('keeps JSX rather than compiling it to createElement', () => {
    // Metro and Vite each run their own JSX transform; pre-compiling here would
    // bypass whatever runtime the app is configured for.
    expect(out).toContain('<View>');
    expect(out).not.toContain('React.createElement');
  });

  it('keeps runtime imports and doc comments', () => {
    expect(out).toContain("import { View } from 'react-native'");
    expect(out).toContain("import React from 'react'");
  });

  it('produces valid JavaScript', () => {
    expect(javaScriptSyntaxErrors(out, 'Screen.jsx')).toEqual([]);
  });
});

describe('javaScriptSyntaxErrors', () => {
  // Every other JavaScript check in the suite leans on this one. It once parsed
  // without running TypeScript's syntactic pass, returned [] for all of these, and
  // raw TypeScript shipped in .js files while those checks stayed green.
  it.each([
    ['a type annotation', 'const x: number = 1;'],
    ['an as-expression', 'const v = null as unknown;'],
    ['a typed parameter', 'export function f(state: { value: unknown }) {}'],
    ['a non-null assertion', 'const y = a!.b;'],
    ['an interface', 'interface A { x: number }'],
    ['a type alias', 'type A = string;'],
    ['a satisfies-expression', 'const c = {} satisfies object;'],
    ['a generic call', 'const [a] = useState<unknown>(null);'],
    ['a generic constructor', 'const m = new Map<string, number>();'],
    ['a generic JSX element', 'const el = <List<string> items={[]} />;'],
  ])('reports %s', (_label, source) => {
    expect(javaScriptSyntaxErrors(source, 'file.jsx')).not.toEqual([]);
  });

  it('says where the problem is', () => {
    expect(javaScriptSyntaxErrors('const a = 1;\nconst b: string = "";\n', 'a.js')[0]).toMatch(
      /line 2/,
    );
  });

  it('accepts ordinary JavaScript, JSX and comparisons', () => {
    const source = [
      "import React, { useState } from 'react';",
      'export function C({ a, b }) {',
      '  const [n, setN] = useState(null);',
      '  const bigger = a < b && b > 0;',
      '  return <View onPress={() => setN(n ?? 1)}>{bigger ? <Text>y</Text> : null}</View>;',
      '}',
    ].join('\n');
    expect(javaScriptSyntaxErrors(source, 'C.jsx')).toEqual([]);
  });

  it('drops TypeScript triple-slash directives', () => {
    const stripped = stripTypes('/// <reference lib="dom" />\nexport const a = 1;\n', 'a.ts');
    expect(stripped).not.toContain('reference lib');
    expect(stripped).toContain('export const a = 1');
  });
});

describe('isTypeOnlyModule', () => {
  it('detects a file that was nothing but types', () => {
    // navigation/types.ts is exactly this: writing an empty module would leave
    // imports pointing at something with no exports.
    const stripped = stripTypes(
      'export type RootStackParamList = { Home: undefined };\ndeclare global {}\n',
      'types.ts',
    );
    expect(isTypeOnlyModule(stripped)).toBe(true);
  });

  it('does not flag a file with real code', () => {
    expect(isTypeOnlyModule(stripTypes('export const a = 1;\n', 'a.ts'))).toBe(false);
  });
});

describe('convertFilesToJavaScript', () => {
  it('renames, strips, and drops type-only files', async () => {
    const { files, dropped } = await convertFilesToJavaScript([
      { path: 'src/screen.tsx', content: 'export default function S(): null { return null; }\n' },
      { path: 'src/types.ts', content: 'export type A = string;\n' },
      { path: 'babel.config.js', content: 'module.exports = {};\n' },
    ]);

    expect(dropped).toEqual(['src/types.ts']);
    expect(files.map((f) => f.path).sort()).toEqual(['babel.config.js', 'src/screen.jsx']);
  });

  it('rewrites extension references inside non-source files', async () => {
    // index.html names the entry explicitly; missing this loads nothing.
    const { files } = await convertFilesToJavaScript([
      { path: 'index.web.tsx', content: 'export const a = 1;\n' },
      { path: 'index.html', content: '<script src="/index.web.tsx"></script>' },
    ]);
    const html = files.find((f) => f.path === 'index.html')!;
    expect(html.content).toContain('/index.web.jsx');
    expect(html.content).not.toContain('index.web.tsx');
  });

  it('leaves every converted file as valid JavaScript', async () => {
    const web = buildWebScaffoldPlan('18.3.1');
    const { files } = await convertFilesToJavaScript([
      ...web.filesToWrite,
      { path: '__tests__/App.test.tsx', content: buildAppTestSource() },
    ]);

    for (const file of files) {
      if (!/\.jsx?$/.test(file.path)) continue;
      expect(javaScriptSyntaxErrors(file.content, file.path), file.path).toEqual([]);
    }
  });

  it('converts the web entry, which is authored in TypeScript on purpose', async () => {
    const { files } = await convertFilesToJavaScript(buildWebScaffoldPlan('18.3.1').filesToWrite);
    const entry = files.find((f) => f.path === 'web/index.jsx')!;
    expect(entry).toBeDefined();
    expect(entry.content).not.toContain('RootTagType');
    expect(entry.content).not.toContain('as unknown as');
    expect(entry.content).toContain('initialProps');
  });
});

describe('language-aware file naming', () => {
  const base = {
    appName: 'X', rnVersion: '0.76.0', platforms: ['android'] as never,
    packageManager: 'npm' as const, plugins: {},
  };

  it('writes armemon.config.js with a JSDoc type for a JavaScript app', () => {
    const config = { ...base, language: 'javascript' as const };
    expect(appConfigFileName(config)).toBe('armemon.config.js');
    const source = serializeAppConfig(config);
    expect(source).toContain('@type {import(');
    expect(source).not.toContain('import type');
    expect(javaScriptSyntaxErrors(source, 'armemon.config.js')).toEqual([]);
  });

  it('writes armemon.config.ts with a real type import for a TypeScript app', () => {
    const config = { ...base, language: 'typescript' as const };
    expect(appConfigFileName(config)).toBe('armemon.config.ts');
    expect(serializeAppConfig(config)).toContain("import type { ArmemonAppConfig }");
  });

  it('emits an untyped user task file for a JavaScript app', () => {
    const js = generateUserRuntimeConfigSource('javascript');
    expect(js).not.toContain('import type');
    expect(js).toContain('export const userTasks = []');
    expect(javaScriptSyntaxErrors(js, 'runtime.config.js')).toEqual([]);
  });
});

describe('no converted file is left pointing at a TypeScript path', () => {
  // The class of bug that shipped twice: conversion renames a file and something
  // else still names the old one. index.html referenced the entry by URL
  // (`/index.tsx`) rather than by its plan path (`web/index.tsx`), so the
  // exact-path rewrite never matched and the page loaded nothing.
  it('rewrites an html src that uses a root-relative URL', async () => {
    const { files } = await convertFilesToJavaScript([
      { path: 'web/index.tsx', content: 'export const a = 1;\n' },
      { path: 'web/index.html', content: '<script type="module" src="/index.tsx"></script>' },
    ]);
    const html = files.find((f) => f.path === 'web/index.html')!;
    expect(html.content).toContain('src="/index.jsx"');
    expect(html.content).not.toContain('.tsx');
  });

  it('rewrites href as well as src, and .ts as well as .tsx', async () => {
    const { files } = await convertFilesToJavaScript([
      { path: 'web/a.ts', content: 'export const a = 1;\n' },
      { path: 'web/index.html', content: '<link href="/a.ts" /><script src="/a.ts"></script>' },
    ]);
    const html = files.find((f) => f.path === 'web/index.html')!;
    expect(html.content).toBe('<link href="/a.js" /><script src="/a.js"></script>');
  });

  it('leaves the whole real web scaffold free of .ts references', async () => {
    const { files } = await convertFilesToJavaScript(buildWebScaffoldPlan('18.3.1').filesToWrite);
    const html = files.find((f) => f.path === 'web/index.html')!;
    expect(html.content).not.toMatch(/\.tsx?"/);
    expect(files.map((f) => f.path)).toContain('web/index.jsx');
  });
});

describe('activeCodeOf', () => {
  // Every generated config is now mostly commented examples, so any check of the
  // form "this file must not contain x" reads documentation unless it goes through
  // here first.
  it('drops block, line and JSX comments but keeps the code', () => {
    const code = activeCodeOf(
      `/** doc */\n// note: middleware: [logger]\nexport const a = { b: 1 };\n`,
      'a.ts',
    );
    expect(code).not.toContain('middleware:');
    expect(code).not.toContain('doc');
    expect(code).toContain('export const a = { b: 1 };');
  });

  it('keeps comment-like text that is really a string', () => {
    const code = activeCodeOf(`export const url = 'https://example.com/a';\n`, 'a.ts');
    expect(code).toContain('https://example.com/a');
  });

  it('returns no active code for a declaration file instead of throwing', () => {
    // transpileModule refuses to emit for a .d.ts input; the wrapper renames it.
    const code = activeCodeOf(`declare module '@env' {\n  export const API_URL: string;\n}\n`, 'env.d.ts');
    expect(code.trim()).toBe('');
  });

  it('falls back to the raw source rather than throwing on unparseable input', () => {
    const source = 'this ( is ) not { valid <<< typescript';
    expect(activeCodeOf(source, 'broken.ts')).toContain('not');
  });
});

describe('references to renamed files inside converted sources', () => {
  // Generated files are written to be read: their comments say which sibling to
  // open next. After conversion those names have to still exist.
  it('rewrites a sibling named in a comment', async () => {
    const { files } = await convertFilesToJavaScript([
      { path: 'src/a/hide.ts', content: 'export const hide = () => {};\n' },
      {
        path: 'src/a/index.ts',
        content: '// Metro resolves ./hide to hide.ts, Vite to hide.web.ts.\nexport const a = 1;\n',
      },
      { path: 'src/a/hide.web.ts', content: 'export const hide = () => {};\n' },
    ]);
    const index = files.find((f) => f.path === 'src/a/index.js')!;
    expect(index.content).toContain('hide.js');
    expect(index.content).toContain('hide.web.js');
    expect(index.content).not.toContain('hide.ts');
  });

  it('rewrites a full path named in a comment', async () => {
    const { files } = await convertFilesToJavaScript([
      { path: 'src/ui/theme.config.ts', content: 'export const c = {};\n' },
      {
        path: 'src/ui/Example.tsx',
        content: 'export const E = () => null;\n// Edit src/ui/theme.config.ts to change colors.\n',
      },
    ]);
    const example = files.find((f) => f.path === 'src/ui/Example.jsx')!;
    expect(example.content).toContain('src/ui/theme.config.js');
  });

  it('leaves a dropped type-only module alone', async () => {
    // types.ts has no JavaScript at all, so it is dropped rather than renamed.
    // Rewriting the name would point the reader at a types.js that never exists.
    const { files, dropped } = await convertFilesToJavaScript([
      { path: 'src/nav/types.ts', content: 'export type RootStackParamList = { Home: undefined };\n' },
      {
        path: 'src/nav/Root.tsx',
        content: 'export const R = () => null;\n// Add the screen to RootStackParamList in ./types.ts too.\n',
      },
    ]);
    expect(dropped).toContain('src/nav/types.ts');
    const root = files.find((f) => f.path === 'src/nav/Root.jsx')!;
    expect(root.content).not.toContain('types.js');
  });
});
