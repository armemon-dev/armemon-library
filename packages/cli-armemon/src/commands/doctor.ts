/**
 * FILE: doctor.ts
 * PATH: packages/cli-armemon/src/commands/doctor.ts
 *
 * WHAT: `armemon doctor` — checks an already-scaffolded app for the wiring armemon
 *       is responsible for, and reports what's missing.
 * WHY:  armemon.config.ts's stated purpose was always to be read back by later
 *       commands, and nothing read it. This is the first command that does. It also
 *       covers the case the init flow can't: an app whose generated files were later
 *       edited, deleted, or lost to a bad merge — where the failure mode is a red
 *       screen at startup with no obvious cause.
 * HOW:  Pure inspection, no writes. Every check names the file and what to do. Exits
 *       non-zero when any check fails, so it works as a CI gate.
 * WHEN: On demand, from inside a scaffolded app.
 *
 * EXPORTS: registerDoctorCommand
 * DEPENDS ON: commander, node:path, node:fs/promises, @armemon-library/cli-kit, ../runCommand,
 *             ../flows/plugins/appState
 * USED BY: packages/cli-armemon/src/index.ts
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { Command } from 'commander';
import {
  logger,
  CliError,
  findAppRoot,
  isCliError,
  managedPath,
  readAppConfig,
  readLayout,
  readPathAliases,
} from '@armemon-library/cli-kit';
import type { ArmemonAppConfig } from '@armemon-library/config-types';
import { runCommand } from '../runCommand.js';
import { writeJson } from '../jsonOutput.js';
import { discoverCatalog } from '../flows/plugins/appState.js';

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

async function exists(target: string): Promise<boolean> {
  return fs
    .access(target)
    .then(() => true)
    .catch(() => false);
}

async function readIfPresent(target: string): Promise<string | null> {
  return fs.readFile(target, 'utf8').catch(() => null);
}

/**
 * Reads whichever extension the app actually uses.
 *
 * armemon scaffolds either TypeScript or JavaScript, so every file it owns exists
 * under one of two names. Checking only the .ts spelling reported a healthy
 * JavaScript app as completely unwired.
 */
async function readEither(appRoot: string, base: string, extensions: string[]): Promise<string | null> {
  for (const extension of extensions) {
    const found = await readIfPresent(path.join(appRoot, `${base}.${extension}`));
    if (found !== null) return found;
  }
  return null;
}

async function existsEither(appRoot: string, base: string, extensions: string[]): Promise<boolean> {
  for (const extension of extensions) {
    if (await exists(path.join(appRoot, `${base}.${extension}`))) return true;
  }
  return false;
}

async function runChecks(appRoot: string): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];

  if (!(await existsEither(appRoot, 'armemon.config', ['ts', 'js']))) {
    throw new CliError(
      `No armemon.config.ts or armemon.config.js in ${appRoot}.`,
      'Run this from inside an app created by "armemon init", or pass --dir.',
    );
  }

  // Every other command stops on an invalid config, so doctor says what is wrong
  // with it rather than stopping too.
  let config: ArmemonAppConfig | null = null;
  try {
    config = await readAppConfig(appRoot);
    checks.push({ name: 'armemon.config', ok: true, detail: 'Readable, and every field is valid.' });
  } catch (error) {
    checks.push({
      name: 'armemon.config',
      ok: false,
      detail: `${error instanceof Error ? error.message : String(error)}${isCliError(error) && error.hint ? ` ${error.hint}` : ''}`,
    });
  }

  // Wherever this app keeps its managed zone: `armemon/`, or `src/armemon/` if it was
  // scaffolded before the move.
  const layout = await readLayout(appRoot);
  const generated = await readEither(appRoot, managedPath(layout, 'runtime.generated'), ['ts', 'js']);
  const registers = generated?.includes('registerRuntimeConfig') ?? false;
  checks.push({
    name: 'runtime.generated',
    ok: registers,
    // Restoring is the only way back: init refuses a folder that already exists, and
    // nothing else regenerates this file.
    detail:
      generated === null
        ? 'Missing. The app cannot start without it — restore it from version control.'
        : registers
          ? 'Present and registers a runtime config.'
          : "Present, but it never calls registerRuntimeConfig, so <KitProvider> has nothing to start. Restore it from version control.",
  });

  const hasRuntimeConfig = await existsEither(appRoot, managedPath(layout, 'runtime.config'), ['ts', 'js']);
  checks.push({
    name: 'runtime.config',
    ok: hasRuntimeConfig,
    detail: hasRuntimeConfig
      ? 'Present — it holds your own init tasks.'
      : 'Missing. It holds your own init tasks: recreate it with `export const userTasks = [];`.',
  });

  const appEntry = await readEither(appRoot, 'App', ['tsx', 'jsx', 'js']);
  const runtimeImport = `./${managedPath(layout, 'runtime.generated')}`;
  const importsRuntime = appEntry?.includes(`${layout.managed}/runtime.generated`) ?? false;
  const rendersProvider = appEntry?.includes('KitProvider') ?? false;
  checks.push({
    name: 'App entry wiring',
    ok: importsRuntime && rendersProvider,
    detail:
      importsRuntime && rendersProvider
        ? 'Imports the generated runtime config and renders <KitProvider>.'
        : `The App entry must import '${runtimeImport}' (${importsRuntime ? 'ok' : 'MISSING'}) and render <KitProvider> (${rendersProvider ? 'ok' : 'MISSING'}).`,
  });

  const pkgRaw = await readIfPresent(path.join(appRoot, 'package.json'));
  const pkg = pkgRaw
    ? (JSON.parse(pkgRaw) as { dependencies?: Record<string, string> })
    : { dependencies: {} };
  const deps = pkg.dependencies ?? {};

  checks.push({
    name: '@armemon-library/core installed',
    ok: '@armemon-library/core' in deps,
    detail: '@armemon-library/core must be a dependency — KitProvider comes from it.',
  });

  // armemon.config, package.json and runtime.generated each say which plugins the app
  // has, and `plugin add`/`plugin remove` keep them in step. A hand edit to one of the
  // three — a plugin deleted from package.json, a registration removed — builds fine and
  // fails at startup, or silently leaves a feature off.
  if (config && generated !== null) {
    const catalog = await discoverCatalog(appRoot).catch(() => []);
    const allDeps = { ...(pkg as { devDependencies?: Record<string, string> }).devDependencies, ...deps };
    const registered = [...generated.matchAll(/import\s*\{\s*(\w+)\s+as\s+plugin\d+\s*\}/g)].map((match) => match[1]);
    const problems: string[] = [];
    for (const id of Object.keys(config.plugins)) {
      const plugin = catalog.find((entry) => entry.manifest.pluginId === id);
      if (!plugin) {
        problems.push(`"${id}" is in armemon.config, but no installed package provides it — run your package manager's install, or \`armemon plugin remove ${id}\``);
        continue;
      }
      if (!(plugin.packageName in allDeps)) problems.push(`${plugin.packageName} is missing from package.json — \`armemon plugin remove ${id}\` then \`armemon plugin add ${id}\` puts it back`);
      // By its export name, or — for a plugin that registers under another name — by the
      // module it is imported from: its package, or its folder in the managed zone.
      const importedFrom = [...generated.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]!);
      const registeredHere =
        registered.includes(plugin.manifest.runtimeExportName) ||
        importedFrom.some((from) => from === plugin.packageName || from.startsWith(`./${id}/`));
      if (!registeredHere) problems.push(`${id} isn't registered in runtime.generated, so it never starts`);
    }
    for (const exportName of registered) {
      const owner = catalog.find((entry) => entry.manifest.runtimeExportName === exportName);
      if (owner && !(owner.manifest.pluginId in config.plugins)) {
        problems.push(`runtime.generated registers ${owner.manifest.pluginId}, which armemon.config doesn't list`);
      }
    }
    checks.push({
      name: 'plugins wired',
      ok: problems.length === 0,
      detail:
        problems.length === 0
          ? `armemon.config, package.json and runtime.generated agree on ${Object.keys(config.plugins).length} plugin(s).`
          : `${problems.join('; ')}.`,
    });
  }

  const fileDeps = Object.entries(deps).filter(([, spec]) => spec.startsWith('file:'));
  const brokenLinks: string[] = [];
  for (const [name, spec] of fileDeps) {
    // A relative file: path means relative to the app's package.json, which is how
    // the package manager reads it — not to wherever doctor happens to be run from.
    const target = path.resolve(appRoot, spec.slice('file:'.length));
    if (!(await exists(target))) brokenLinks.push(`${name} -> ${spec.slice('file:'.length)}`);
  }
  checks.push({
    name: 'local package links',
    ok: brokenLinks.length === 0,
    detail:
      brokenLinks.length === 0
        ? `${fileDeps.length} file: link(s) resolve.`
        : `Broken: ${brokenLinks.join(', ')}. These are absolute paths on the machine that scaffolded the app, so they don't survive being cloned or moved.`,
  });

  const metro = await readIfPresent(path.join(appRoot, 'metro.config.js'));
  checks.push({
    name: 'metro watchFolders',
    ok: fileDeps.length === 0 || (metro?.includes('watchFolders') ?? false),
    detail:
      'Metro does not follow symlinks outside its root, so every file: package needs a watchFolders entry.',
  });

  const babel = await readIfPresent(path.join(appRoot, 'babel.config.js'));
  if (babel?.includes('react-native-reanimated/plugin')) {
    const plugins = babel.slice(babel.indexOf('plugins'));
    const lastIndex = plugins.lastIndexOf('react-native-reanimated/plugin');
    const anythingAfter = plugins.slice(lastIndex).match(/,\s*[['"]/);
    checks.push({
      name: 'reanimated babel plugin order',
      ok: !anythingAfter,
      detail: "react-native-reanimated/plugin must be the LAST entry in babel.config.js's plugins.",
    });
  }

  const gitignoreLines = ((await readIfPresent(path.join(appRoot, '.gitignore'))) ?? '')
    .split('\n')
    .map((line) => line.trim());

  if (config?.platforms.includes('web')) {
    checks.push({
      name: 'web build output ignored by git',
      ok: gitignoreLines.some((line) => ['web/dist', 'web/dist/', '/web/dist', '/web/dist/'].includes(line)),
      detail: 'Add `web/dist/` to .gitignore — it is build output, and committing it puts every build in the history.',
    });
  }

  // The `@/` alias is declared three times — tsconfig for the type checker, Babel for
  // Metro, Vite for web — and each can drift alone. Only one missing still builds
  // somewhere, which is what makes it hard to notice.
  const babelAlias = /module-resolver[\s\S]*?alias[\s\S]*?['"]@['"]\s*:/.test(babel ?? '');
  const tsAlias = readPathAliases(appRoot).some((alias) => alias.prefix === '@/');
  if (babelAlias || tsAlias) {
    const isTypeScript = config?.language !== 'javascript';
    const missing = [
      !babelAlias ? 'babel.config.js (module-resolver), which Metro uses' : null,
      isTypeScript && !tsAlias ? 'tsconfig.json (compilerOptions.paths "@/*")' : null,
    ].filter(Boolean);
    if (config?.platforms.includes('web')) {
      const vite = await readEither(appRoot, 'web/vite.config', ['ts', 'js']);
      if (!/find:\s*\/\^@\(\?=/.test(vite ?? '')) missing.push('web/vite.config (resolve.alias), which the web build uses');
    }
    checks.push({
      name: '@/ import alias',
      ok: missing.length === 0,
      detail:
        missing.length === 0
          ? 'Declared everywhere it is resolved.'
          : `\`@/\` imports are set up in some places but not in ${missing.join(', or ')} — they will fail to resolve there.`,
    });
  }

  // `npm ci` refuses a lockfile that disagrees with package.json, so a mismatch fails
  // the first clean install on another machine and nowhere locally.
  const lockRaw = await readIfPresent(path.join(appRoot, 'package-lock.json'));
  if (pkgRaw && lockRaw) {
    try {
      const lock = JSON.parse(lockRaw) as {
        packages?: Record<string, { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>;
      };
      const locked = lock.packages?.[''];
      const declared = JSON.parse(pkgRaw) as { devDependencies?: Record<string, string> };
      const differs = (a: Record<string, string> = {}, b: Record<string, string> = {}) =>
        [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((name) => a[name] !== b[name]);
      const drift = locked
        ? [...differs(deps, locked.dependencies), ...differs(declared.devDependencies, locked.devDependencies)]
        : [];
      checks.push({
        name: 'package-lock.json matches package.json',
        ok: locked !== undefined && drift.length === 0,
        detail:
          locked === undefined
            ? 'package-lock.json has no root entry. Run `npm install` to rewrite it.'
            : drift.length === 0
              ? 'In step — `npm ci` will install exactly what package.json asks for.'
              : `Out of step on ${drift.join(', ')}. \`npm ci\` refuses that; run \`npm install\` once to bring the lockfile in line.`,
      });
    } catch {
      checks.push({
        name: 'package-lock.json matches package.json',
        ok: false,
        detail: "package-lock.json isn't valid JSON. Delete it and run `npm install`.",
      });
    }
  }

  if ('react-native-dotenv' in deps || (await exists(path.join(appRoot, '.env')))) {
    checks.push({
      name: '.env ignored by git',
      ok: gitignoreLines.includes('.env'),
      detail: 'Add `.env` to .gitignore before committing anything real to it.',
    });
  }

  return checks;
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .argument('[appDir]', 'The app directory — the same as --dir')
    .description("Check a scaffolded app's armemon wiring")
    .option('--dir <path>', 'The app directory (defaults to the nearest one at or above here)')
    .option('--json', 'Emit machine-readable JSON instead of prose')
    .addHelpText('after', '\nExits 1 when any check fails, so it works as a CI gate.')
    .action(async (appDir: string | undefined, options: { dir?: string; json?: boolean }) => {
      await runCommand(async () => {
        if (appDir !== undefined && options.dir !== undefined && path.resolve(appDir) !== path.resolve(options.dir)) {
          throw new CliError(
            `Two different apps were named: "${appDir}" and --dir "${options.dir}".`,
            'Pass one of them.',
          );
        }

        // Like every other command: a folder named explicitly is used as it is;
        // otherwise the nearest app at or above the current directory.
        const named = appDir ?? options.dir;
        const start = path.resolve(process.cwd(), named ?? '.');
        const appRoot = named !== undefined ? start : ((await findAppRoot(start)) ?? start);

        const checks = await runChecks(appRoot);
        const failed = checks.filter((check) => !check.ok);

        if (options.json) {
          writeJson({ ok: failed.length === 0, appRoot, checks });
        } else {
          for (const check of checks) {
            if (check.ok) logger.success(`${check.name} — ${check.detail}`);
            else logger.error(`${check.name} — ${check.detail}`);
          }
          if (failed.length === 0) logger.info('Everything armemon is responsible for looks wired.');
        }

        if (failed.length > 0) process.exitCode = 1;
      }, { json: options.json });
    });
}
