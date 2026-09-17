/**
 * FILE: verify.ts
 * PATH: packages/cli-kit/src/verify.ts
 *
 * WHAT: Checks that the app armemon just generated actually works, before telling
 *       the user it's ready.
 * WHY:  Two bugs reached a user in one day — a `web` script pointing at
 *       `vite.config.ts` in a JavaScript app where the file is `vite.config.js`, and
 *       an index.html still referencing the pre-conversion entry — and armemon
 *       printed "Done — no manual wiring needed" for both. A scaffolder that hands
 *       over a broken app and calls it finished has failed at its one job. Checking
 *       is cheap: armemon knows what it wrote and which commands it promised would
 *       work, so it can run them.
 *
 *       The script check specifically exists because both of those bugs were a
 *       generated command naming a file that had been renamed — something no type
 *       checker looks at and no bundler sees until the user types the command.
 * HOW:  Three checks, each skippable by circumstance rather than by flag: every
 *       `--config`/entry path named in a package.json script exists; `tsc --noEmit`
 *       for TypeScript apps; and the web build, run through the package script so
 *       it exercises what the user will actually type. Failures are reported, never
 *       thrown — the app exists and may be salvageable, and deleting it would be
 *       worse than describing what's wrong.
 * WHEN: Run at the end of every init unless --no-verify is passed.
 *
 * EXPORTS: verifyGeneratedApp, typeCheckErrorFiles, VerificationCheck, VerificationReport,
 *          AppliedExpectations
 * DEPENDS ON: node:path, node:fs/promises, execa
 * USED BY: packages/cli-armemon/src/flows/initReactNative.ts
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { execa } from 'execa';

export interface VerificationCheck {
  name: string;
  ok: boolean;
  detail: string;
  /** App-relative files a failure was reported in, when the check can tell. */
  files?: string[];
}

/**
 * The files tsc reported errors in — `src/screens/X/index.tsx(3,5): error TS2304`.
 * The detail keeps only the first lines, so this reads the whole output: a command can
 * then tell whether a failure is in something it touched or was already there.
 */
export function typeCheckErrorFiles(output: string): string[] {
  const files = new Set<string>();
  for (const match of output.matchAll(/^(.+?)\(\d+,\d+\): error TS\d+/gm)) {
    files.add(match[1]!.trim().split(path.sep).join('/'));
  }
  return [...files];
}

export interface VerificationReport {
  checks: VerificationCheck[];
  ok: boolean;
}

/**
 * What the plans said should end up in the app.
 *
 * Checking that the app BUILDS is not enough: a contribution that silently never
 * applied still builds perfectly. The web splash was dropped for exactly that
 * reason — an equality check on 'index.html' stopped matching when the file moved
 * to web/index.html, and every downstream check stayed green because a missing
 * <div> breaks nothing. A plan is a promise; this checks the promise was kept.
 */
export interface AppliedExpectations {
  /** Paths that must exist, post language conversion. */
  files?: string[];
  /** Snippets that must appear in the web target's index.html. */
  htmlSnippets?: string[];
  /** Entries that must appear in babel.config.js. */
  babelPlugins?: string[];
  /** Lines that must appear at the top of index.js. */
  entryPrelude?: string[];
  /** Entries that must appear in .gitignore. */
  gitignoreEntries?: string[];
}

export interface VerifyOptions {
  appRoot: string;
  isTypeScript: boolean;
  hasWeb: boolean;
  packageManager: string;
  expectations?: AppliedExpectations;
}

async function exists(target: string): Promise<boolean> {
  return fs
    .access(target)
    .then(() => true)
    .catch(() => false);
}

/**
 * Every file path a generated script names must exist.
 *
 * Catches the exact failure that shipped: a renamed file leaving a script pointing
 * at the old name. Nothing else in the pipeline looks at script strings.
 */
async function checkScriptPaths(appRoot: string): Promise<VerificationCheck> {
  const pkg = JSON.parse(await fs.readFile(path.join(appRoot, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };

  const broken: string[] = [];
  for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
    // Any argument that looks like a path into the project.
    for (const match of command.matchAll(/(?:^|\s)((?:\.\/)?[\w.-]+(?:\/[\w.-]+)+)(?=\s|$)/g)) {
      const candidate = match[1];
      if (!candidate || !/\.[a-z]+$/.test(candidate)) continue;
      if (!(await exists(path.join(appRoot, candidate)))) {
        broken.push(`"${name}" points at ${candidate}, which doesn't exist`);
      }
    }
  }

  return {
    name: 'package.json scripts',
    ok: broken.length === 0,
    detail: broken.length === 0 ? 'Every path a script names exists.' : broken.join('; '),
  };
}

async function checkTypeScript(appRoot: string): Promise<VerificationCheck> {
  const result = await execa('npx', ['tsc', '--noEmit'], { cwd: appRoot, reject: false });
  const output = `${result.stdout}\n${result.stderr}`.trim();
  const files = result.exitCode === 0 ? [] : typeCheckErrorFiles(output);
  return {
    name: 'type-check',
    ok: result.exitCode === 0,
    detail: result.exitCode === 0 ? 'tsc --noEmit passed.' : output.split('\n').slice(0, 8).join('\n'),
    ...(files.length > 0 ? { files } : {}),
  };
}

async function checkWebBuild(appRoot: string, packageManager: string): Promise<VerificationCheck> {
  // Through the package script, not the bundler directly: the script is what the
  // user runs, and it is where a stale path hides. Running vite directly is what
  // let a broken --config reach a user.
  const runner = packageManager === 'npm' ? ['run', 'web:build'] : ['web:build'];
  const result = await execa(packageManager, runner, { cwd: appRoot, reject: false });
  const output = `${result.stdout}\n${result.stderr}`.trim();
  return {
    name: 'web build',
    ok: result.exitCode === 0,
    detail:
      result.exitCode === 0
        ? 'The web target builds.'
        : output.split('\n').slice(-8).join('\n'),
  };
}

async function readOr(appRoot: string, relative: string): Promise<string> {
  return fs.readFile(path.join(appRoot, relative), 'utf8').catch(() => '');
}

/** Every contribution the plans declared has to be findable in the finished app. */
async function checkExpectations(
  appRoot: string,
  expectations: AppliedExpectations,
): Promise<VerificationCheck> {
  const problems: string[] = [];

  for (const relative of expectations.files ?? []) {
    if (!(await exists(path.join(appRoot, relative)))) {
      problems.push(`${relative} was planned but not written`);
    }
  }

  const sources: Array<[keyof AppliedExpectations, string, string]> = [
    ['htmlSnippets', 'web/index.html', 'web/index.html'],
    ['babelPlugins', 'babel.config.js', 'babel.config.js'],
    ['entryPrelude', 'index.js', 'index.js'],
    ['gitignoreEntries', '.gitignore', '.gitignore'],
  ];

  for (const [key, file, label] of sources) {
    const wanted = (expectations[key] as string[] | undefined) ?? [];
    if (wanted.length === 0) continue;
    const content = await readOr(appRoot, file);
    for (const snippet of wanted) {
      if (!content.includes(snippet)) {
        const preview = snippet.split('\n')[0]?.slice(0, 60) ?? snippet.slice(0, 60);
        problems.push(`${label} is missing a planned entry: ${preview}`);
      }
    }
  }

  return {
    name: 'planned changes applied',
    ok: problems.length === 0,
    detail:
      problems.length === 0
        ? 'Everything the plugins asked for is in the app.'
        : problems.join('; '),
  };
}

export async function verifyGeneratedApp(options: VerifyOptions): Promise<VerificationReport> {
  const checks: VerificationCheck[] = [await checkScriptPaths(options.appRoot)];

  if (options.expectations) {
    checks.push(await checkExpectations(options.appRoot, options.expectations));
  }

  if (options.isTypeScript) {
    checks.push(await checkTypeScript(options.appRoot));
  }
  if (options.hasWeb) {
    checks.push(await checkWebBuild(options.appRoot, options.packageManager));
  }

  return { checks, ok: checks.every((check) => check.ok) };
}
