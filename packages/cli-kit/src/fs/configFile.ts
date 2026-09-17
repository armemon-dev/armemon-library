/**
 * FILE: configFile.ts
 * PATH: packages/cli-kit/src/fs/configFile.ts
 *
 * WHAT: Serializes and writes the scaffolded app's armemon.config.ts.
 * WHY:  armemon.config.ts is regenerated wholesale from an in-memory ArmemonAppConfig
 *       object each time it changes (after each plugin wizard completes, and again
 *       once at the very end) rather than hand-patched as text — the file is meant to
 *       be read by humans, not edited by them, so re-serializing the whole object is
 *       simpler and more robust than trying to surgically patch a TS AST. Writing
 *       after every plugin wizard (not just at the end) means a crash mid-wizard
 *       leaves a resumable, accurate record of what was chosen so far.
 * HOW:  JSON.stringify the config object into a small TS module with a typed default
 *       export.
 * WHEN: Called once after the initial skeleton is created, then again after every
 *       plugin wizard's plan() step completes.
 *
 * EXPORTS: serializeAppConfig, appConfigFileName, writeAppConfig, readAppConfig, validateAppConfig,
 *          findAppConfigFile, findAppRoot
 * DEPENDS ON: @armemon-library/config-types, node:path, node:fs/promises
 * USED BY: packages/cli-armemon/src/flows/initReactNative.ts, packages/cli-armemon/src/flows/screenShared.ts
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import type { ArmemonAppConfig } from '@armemon-library/config-types';
import { CliError } from '../errors.js';

export function serializeAppConfig(config: ArmemonAppConfig): string {
  // A JavaScript app has no @armemon-library/config-types to import, so the type is carried
  // as a JSDoc annotation instead — editors still get completion from it, and the
  // file stays valid JavaScript.
  if (config.language === 'javascript') {
    return `/** @type {import('@armemon-library/config-types').ArmemonAppConfig} */
const config = ${JSON.stringify(config, null, 2)};

export default config;
`;
  }

  return `import type { ArmemonAppConfig } from '@armemon-library/config-types';

const config: ArmemonAppConfig = ${JSON.stringify(config, null, 2)};

export default config;
`;
}

export function appConfigFileName(config: ArmemonAppConfig): string {
  return config.language === 'javascript' ? 'armemon.config.js' : 'armemon.config.ts';
}

export async function writeAppConfig(appRoot: string, config: ArmemonAppConfig): Promise<void> {
  const configPath = path.join(appRoot, appConfigFileName(config));
  await fs.writeFile(configPath, serializeAppConfig(config), 'utf8');
}

/**
 * The path to whichever armemon.config the app actually has, or null.
 *
 * Both spellings exist because a JavaScript app has no .ts file; a command that
 * only looked for one reported a healthy app as unscaffolded.
 */
export async function findAppConfigFile(appRoot: string): Promise<string | null> {
  for (const name of ['armemon.config.ts', 'armemon.config.js']) {
    const candidate = path.join(appRoot, name);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try the other spelling.
    }
  }
  return null;
}

/**
 * The nearest directory at or above `start` holding an armemon.config — so a command
 * run from src/screens works the way git does from any subfolder.
 */
export async function findAppRoot(start: string): Promise<string | null> {
  let current = path.resolve(start);
  for (;;) {
    if (await findAppConfigFile(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Reads armemon.config back into the object it was written from.
 *
 * The file is a real source module, so it cannot simply be JSON.parsed — and it
 * cannot be imported either, since a .ts file is not loadable by node and a .js one
 * would execute app code inside the CLI. What it always is, though, is a single
 * object literal of pure JSON between the first brace and its match: armemon
 * generates it with JSON.stringify. So the object is extracted by brace matching
 * and parsed.
 *
 * That tolerates reformatting and the hand-edits armemon itself suggests (adding a
 * platform to the array). It does NOT tolerate comments or trailing commas, so a
 * parse failure names the file and says what to fix rather than surfacing a raw
 * SyntaxError.
 */
export async function readAppConfig(appRoot: string): Promise<ArmemonAppConfig> {
  const configPath = await findAppConfigFile(appRoot);
  if (!configPath) {
    throw new CliError(
      `No armemon.config.ts or armemon.config.js in ${appRoot}.`,
      'Run this from inside an app created by "armemon init", or pass --dir.',
    );
  }

  const source = await fs.readFile(configPath, 'utf8');

  // NOT the first brace in the file: a TypeScript config opens with
  // `import type { ArmemonAppConfig } from …` and a JavaScript one with a
  // `/** @type {import(…)} */` annotation, so "first {" finds an import or a
  // comment every single time. Start at the assignment instead.
  const assignment = /(?:const|let|var)\s+\w+\s*(?::[^=]*?)?=\s*\{/.exec(source);
  const start = assignment ? source.indexOf('{', assignment.index + assignment[0].length - 1) : -1;
  if (start === -1) {
    throw new CliError(
      `${path.basename(configPath)} has no config object.`,
      'Expected a `const config = { ... }` assignment.',
    );
  }

  let depth = 0;
  let end = -1;
  let inString: string | null = null;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (character === '\\') index += 1;
      else if (character === inString) inString = null;
      continue;
    }
    if (character === '"' || character === "'") inString = character;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }

  if (end === -1) {
    throw new CliError(`${path.basename(configPath)} has an unclosed config object.`, 'Check for a missing }.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source.slice(start, end + 1));
  } catch (error) {
    throw new CliError(
      `Could not read ${path.basename(configPath)}: ${error instanceof Error ? error.message : String(error)}`,
      'It must stay plain JSON — no comments, no trailing commas, double-quoted keys.',
    );
  }
  return validateAppConfig(parsed, path.basename(configPath));
}

const PLATFORMS = ['ios', 'android', 'web', 'windows', 'macos'];
const PACKAGE_MANAGERS = ['npm', 'yarn', 'pnpm', 'bun'];
const LANGUAGES = ['typescript', 'javascript'];

/**
 * The parsed config, checked against ArmemonAppConfig before anything relies on it.
 *
 * A hand-edit that parses is not a hand-edit that's right: `"platforms": ["andriod"]`
 * was accepted, so `add android` believed the platform was already there and every
 * command after it worked from a config describing a different app. Every problem is
 * named at once, so fixing the file is one edit rather than one per run.
 *
 * Fields older apps predate are filled in rather than refused: `language` (every app
 * was TypeScript before it existed) and `plugins`.
 */
export function validateAppConfig(value: unknown, fileName = 'armemon.config'): ArmemonAppConfig {
  const problems: string[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CliError(`${fileName} doesn't hold a config object.`, 'Expected `const config = { "appName": … }`.');
  }
  // Filled in where missing rather than spread underneath: spreading reordered the keys,
  // so the next command that wrote the config back moved "plugins" to the top of it.
  const config: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  if (config.language === undefined) config.language = 'typescript';
  if (config.plugins === undefined) config.plugins = {};

  if (typeof config.appName !== 'string' || config.appName.length === 0) problems.push('"appName" must be a non-empty string');
  if (typeof config.rnVersion !== 'string' || config.rnVersion.length === 0) problems.push('"rnVersion" must be a version string, like "0.76.0"');
  if (!Array.isArray(config.platforms)) {
    problems.push(`"platforms" must be a list, like ["ios", "android"]`);
  } else {
    const unknown = config.platforms.filter((entry) => !PLATFORMS.includes(entry as string));
    if (unknown.length > 0) {
      problems.push(`"platforms" has ${unknown.map((entry) => JSON.stringify(entry)).join(', ')} — valid ones are ${PLATFORMS.join(', ')}`);
    }
  }
  if (!PACKAGE_MANAGERS.includes(config.packageManager as string)) {
    problems.push(`"packageManager" must be one of ${PACKAGE_MANAGERS.join(', ')}`);
  }
  if (!LANGUAGES.includes(config.language as string)) {
    problems.push(`"language" must be "typescript" or "javascript"`);
  }
  if (!config.plugins || typeof config.plugins !== 'object' || Array.isArray(config.plugins)) {
    problems.push('"plugins" must be an object keyed by plugin id');
  }

  if (problems.length > 0) {
    throw new CliError(
      `${fileName} has ${problems.length === 1 ? 'a problem' : `${problems.length} problems`}: ${problems.join('; ')}.`,
      'Fix it by hand — or restore it from version control if it was changed by mistake.',
    );
  }
  // Every field was checked above; the compiler can't follow that, hence unknown.
  return config as unknown as ArmemonAppConfig;
}
