/**
 * FILE: languageConversion.ts
 * PATH: packages/cli-kit/src/fs/languageConversion.ts
 *
 * WHAT: Converts generated TypeScript source to plain JavaScript — renaming
 *       .ts/.tsx to .js/.jsx, stripping every type construct, and dropping files
 *       that were nothing but types.
 * WHY:  React Native has shipped no JavaScript template since 0.71: its CLI always
 *       scaffolds TypeScript and `--template` only accepts a third-party package. So
 *       "JavaScript" can't be delegated — armemon has to produce it.
 *
 *       The conversion is CENTRAL, at the write boundary, rather than a branch in
 *       every generator. Plugin authors keep writing one TypeScript template and get
 *       correct JavaScript for free, which matters most for third-party plugins: the
 *       alternative is asking every author to maintain two copies of every file and
 *       silently producing broken apps when they don't.
 * HOW:  TypeScript's own transpileModule with `jsx: Preserve` does the stripping —
 *       the reference implementation, so `declare global`, type-only imports,
 *       interfaces, generics and satisfies-expressions are all handled correctly.
 *       (sucrase was tried first and can't parse a generic type argument in a .tsx
 *       file unless it also transforms JSX, which we need to keep.) transpileModule
 *       re-indents to 4 spaces and collapses some JSX, so prettier reformats the
 *       result back to the project's style; a prettier failure is non-fatal and
 *       falls back to the raw output, because bad formatting is a lesser problem
 *       than a failed scaffold.
 * WHEN: Applied by the init flow to every file it is about to write, when the user
 *       chose JavaScript.
 *
 * EXPORTS: stripTypes, activeCodeOf, javaScriptPathFor, isTypeOnlyModule,
 *          convertFilesToJavaScript, formatGeneratedSource, javaScriptSyntaxErrors
 * DEPENDS ON: typescript, prettier, @armemon-library/config-types
 * USED BY: packages/cli-armemon/src/flows/initReactNative.ts
 */

import ts from 'typescript';
import * as prettier from 'prettier';
import type { PluginInstallPlan } from '@armemon-library/config-types';

type GeneratedFile = PluginInstallPlan['filesToWrite'][number];

/** .ts -> .js, .tsx -> .jsx; anything else untouched. */
export function javaScriptPathFor(filePath: string): string {
  if (filePath.endsWith('.d.ts')) return filePath.replace(/\.d\.ts$/, '.js');
  if (filePath.endsWith('.tsx')) return filePath.replace(/\.tsx$/, '.jsx');
  if (filePath.endsWith('.ts')) return filePath.replace(/\.ts$/, '.js');
  return filePath;
}

/** `/// <reference ... />` is TypeScript-only and survives transpilation as a comment. */
function stripTripleSlashDirectives(source: string): string {
  return source.replace(/^\s*\/\/\/\s*<reference[^>]*\/>\s*$\n?/gm, '');
}

export function stripTypes(source: string, fileName: string): string {
  const output = ts.transpileModule(source, {
    fileName,
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      // Preserve, not React: Metro and Vite both run their own JSX transform, and
      // emitting React.createElement here would bypass the app's configured runtime.
      jsx: ts.JsxEmit.Preserve,
      removeComments: false,
      isolatedModules: true,
    },
  }).outputText;

  return stripTripleSlashDirectives(output);
}

/**
 * `source` with every comment removed.
 *
 * Generated config files document each option they accept as commented-out
 * examples, so a plain substring search over one of them finds things the file
 * merely *describes* — `middleware:` inside a commented example is not a
 * middleware field, and a doc line explaining why armemon avoids `require()` is
 * not a `require()` call. Checks that ask "does this file DO x" have to run on
 * the code alone, or they fail (or pass) on prose.
 *
 * TypeScript's own emitter does the removal rather than a regex, so a `//` inside
 * a string literal or a URL in a template literal survives, as it must.
 */
export function activeCodeOf(source: string, fileName: string): string {
  // transpileModule refuses to emit for a .d.ts input ("Output generation failed"),
  // so declaration files are transpiled under a .ts name — they contain nothing but
  // types, which correctly leaves no active code at all.
  const emitName = fileName.endsWith('.d.ts') ? fileName.replace(/\.d\.ts$/, '.ts') : fileName;
  try {
    return ts.transpileModule(source, {
      fileName: emitName,
      compilerOptions: {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.Preserve,
        removeComments: true,
        isolatedModules: true,
      },
    }).outputText;
  } catch {
    // Returning the source untouched is the conservative failure: a caller asking
    // "does this file do x" then sees the comments too, which can only make the
    // check stricter, never let something through.
    return source;
  }
}

/**
 * Everything in `source` that is not valid JavaScript, read as a .js/.jsx file.
 *
 * Used to prove a conversion really produced JavaScript: a leftover type annotation
 * or `as` fails Metro's build, and the only place it shows up otherwise is the
 * user's app.
 *
 * Parsing alone can't prove that. TypeScript's parser accepts type annotations, `as`,
 * `!` and `interface` in a JavaScript file without complaint, and reports them in a
 * separate syntactic pass that only a program runs. That is how this check once
 * returned nothing for `const x: number = 1` and let raw TypeScript ship in .js files.
 *
 * Type arguments need their own look: in a JavaScript file `useState<unknown>(null)`
 * is not an error to any pass — it parses as two comparisons, `useState < unknown >
 * (null)` — so it builds and then throws when it runs. Reading the same source as
 * TypeScript shows what it was written as.
 */
export function javaScriptSyntaxErrors(source: string, fileName: string): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JSX);
  const at = (sourceFile: ts.SourceFile, position: number) =>
    `line ${sourceFile.getLineAndCharacterOfPosition(position).line + 1}`;

  const defaultHost = ts.createCompilerHost({});
  const program = ts.createProgram({
    rootNames: [fileName],
    options: { allowJs: true, noResolve: true, noLib: true, noEmit: true },
    host: {
      ...defaultHost,
      getSourceFile: (name) => (name === fileName ? file : undefined),
      fileExists: (name) => name === fileName,
      readFile: (name) => (name === fileName ? source : undefined),
    },
  });
  const errors = program
    .getSyntacticDiagnostics(file)
    .map((d) => `${ts.flattenDiagnosticMessageText(d.messageText, ' ')} (${at(file, d.start ?? 0)})`);

  const asTypeScript = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TSX,
  );
  const visit = (node: ts.Node): void => {
    if (
      (ts.isCallExpression(node) ||
        ts.isNewExpression(node) ||
        ts.isTaggedTemplateExpression(node) ||
        ts.isJsxOpeningElement(node) ||
        ts.isJsxSelfClosingElement(node)) &&
      node.typeArguments?.length
    ) {
      errors.push(
        `Type arguments can only be used in TypeScript files. (${at(asTypeScript, node.typeArguments.pos)})`,
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(asTypeScript);

  return [...new Set(errors)];
}

/**
 * True when nothing survives type-stripping — a file that only declared interfaces,
 * type aliases or a `declare global` block. Writing an empty module would leave the
 * app with dead files and, worse, imports pointing at something with no exports.
 */
export function isTypeOnlyModule(strippedSource: string): boolean {
  const meaningful = strippedSource
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^\s*export\s*\{\s*\}\s*;?\s*$/gm, '')
    .trim();
  return meaningful.length === 0;
}

/**
 * How armemon writes code when nothing else has an opinion.
 *
 * `endOfLine: 'auto'` rather than prettier's "lf" default: these options also format
 * files that already exist in the app, and rewriting a CRLF checkout to LF turns a
 * one-line change into a whole-file diff for every Windows developer on the project.
 */
const ARMEMON_STYLE = {
  singleQuote: true,
  trailingComma: 'all',
  printWidth: 100,
  tabWidth: 2,
  semi: true,
  endOfLine: 'auto',
} as const satisfies prettier.Options;

/** Best-effort formatting; a parser failure returns the input unchanged. */
export async function formatGeneratedSource(source: string, filePath: string): Promise<string> {
  try {
    return await prettier.format(source, { ...ARMEMON_STYLE, filepath: filePath });
  } catch {
    return source;
  }
}

/**
 * Formats a file that already exists in the app — re-aligning the managed zone.
 *
 * It differs from formatGeneratedSource in the one way that matters: it asks the app
 * what its style is first. armemon canonicalizes its own files so that the next
 * command can read them, but a project that ships a Prettier config has already
 * decided how its code looks, and armemon's defaults are not a second vote. Whatever
 * the source, the file's existing line endings are kept.
 */
export async function formatManagedSource(source: string, filePath: string): Promise<string> {
  try {
    const projectStyle = await prettier.resolveConfig(filePath);
    return await prettier.format(source, {
      ...ARMEMON_STYLE,
      ...(projectStyle ?? {}),
      filepath: filePath,
      endOfLine: projectStyle?.endOfLine ?? 'auto',
    });
  } catch {
    return source;
  }
}

export interface ConversionResult {
  files: GeneratedFile[];
  /** Paths dropped because they held only types. */
  dropped: string[];
}

export async function convertFilesToJavaScript(
  files: GeneratedFile[],
): Promise<ConversionResult> {
  const converted: GeneratedFile[] = [];
  const dropped: string[] = [];

  // Generated imports are extensionless and need no rewriting, but plenty of files
  // reference a source file by its full name — index.html's <script src>, and the
  // documentation comments that tell the reader which file to open next. Those
  // references have to follow the rename, or the page loads nothing and every
  // pointer in the docs names a file the app doesn't have.
  const sources = files.filter((file) => /\.tsx?$/.test(file.path));

  // A type-only module (navigation's types.ts) is dropped entirely rather than
  // renamed, so its name must NOT be rewritten: pointing the reader at types.js
  // would name a file that does not exist either. Computed up front because the
  // rewrite has to know before it runs.
  const droppedPaths = new Set(
    sources
      .filter((file) => isTypeOnlyModule(stripTypes(file.content, file.path)))
      .map((file) => file.path),
  );

  const renames = sources
    .filter((file) => !droppedPaths.has(file.path))
    .map((file) => [file.path, javaScriptPathFor(file.path)] as const)
    .filter(([from, to]) => from !== to);

  // The same files named without their directory — "hide.ts", "runtime.config.ts".
  // A doc comment names a sibling that way far more often than by full path.
  const basenameRenames = [
    ...new Map(
      renames.map(([from, to]) => [from.split('/').pop()!, to.split('/').pop()!] as const),
    ),
  ].filter(([from]) => !droppedPaths.has(from) && ![...droppedPaths].some((p) => p.endsWith(`/${from}`)));

  const rewriteReferences = (content: string, filePath: string): string => {
    // Exact plan paths first, then bare filenames.
    let out = renames.reduce((acc, [from, to]) => acc.split(from).join(to), content);
    out = basenameRenames.reduce((acc, [from, to]) => acc.split(from).join(to), out);

    // Then HTML src/href attributes, which name the file by URL rather than by its
    // path in the plan — `/index.tsx` for a plan entry of `web/index.tsx`, so the
    // exact-path pass above cannot see it. Missing this shipped an index.html
    // pointing at a .tsx that conversion had already renamed.
    if (filePath.endsWith('.html')) {
      out = out.replace(
        /((?:src|href)=")([^"]+?)\.(tsx|ts)(")/g,
        (_match, prefix: string, base: string, extension: string, suffix: string) =>
          `${prefix}${base}.${extension === 'tsx' ? 'jsx' : 'js'}${suffix}`,
      );
    }

    return out;
  };

  for (const file of files) {
    if (!/\.tsx?$/.test(file.path)) {
      converted.push({ ...file, path: file.path, content: rewriteReferences(file.content, file.path) });
      continue;
    }

    const stripped = stripTypes(file.content, file.path);
    if (droppedPaths.has(file.path)) {
      dropped.push(file.path);
      continue;
    }

    const jsPath = javaScriptPathFor(file.path);
    converted.push({
      ...file,
      path: jsPath,
      // Converted sources get the rewrite too. They didn't, and every generated
      // file that pointed the reader at "./hide.ts" or "theme.config.ts" kept
      // saying so in an app where neither name existed any more.
      content: await formatGeneratedSource(rewriteReferences(stripped, jsPath), jsPath),
    });
  }

  return { files: converted, dropped };
}
