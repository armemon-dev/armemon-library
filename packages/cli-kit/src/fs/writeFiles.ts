/**
 * FILE: writeFiles.ts
 * PATH: packages/cli-kit/src/fs/writeFiles.ts
 *
 * WHAT: Writes a batch of {path, content} entries (paths relative to the app root)
 *       to disk, creating parent directories as needed.
 * WHY:  Every plugin's plan() returns filesToWrite in this shape; centralizing the
 *       actual write here (rather than each plugin writing its own files) is what
 *       lets the init flow batch every plugin's writes into one pass (Step 9), after
 *       every wizard has finished planning.
 * HOW:  Sequential fs.mkdir(recursive) + fs.writeFile per entry.
 * WHEN: Called once by the init flow, after all selected plugins' + built-ins'
 *       plan() steps have completed.
 *
 * EXPORTS: writeGeneratedFiles, renderGeneratedFile
 * DEPENDS ON: node:path, node:fs/promises, @armemon-library/config-types
 * USED BY: packages/cli-armemon/src/flows/initReactNative.ts
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { isManaged, type AppLayout, type PluginInstallPlan } from '@armemon-library/config-types';
import { formatGeneratedSource } from './languageConversion.js';

/** Only source is formatted: a README or an index.html is not armemon's to reshape. */
const FORMATTABLE = /\.(ts|tsx|js|jsx)$/;

export async function writeGeneratedFiles(
  appRoot: string,
  files: PluginInstallPlan['filesToWrite'],
  options: { layout?: AppLayout } = {},
): Promise<void> {
  for (const file of files) {
    const fullPath = path.join(appRoot, file.path);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, await renderGeneratedFile(appRoot, file, options), 'utf8');
  }
}

/**
 * Exactly what writeGeneratedFiles puts on disk for one file.
 *
 * The managed zone is the only place armemon parses and re-edits, so it is the only
 * place whose formatting has to be canonical — every later command reads these files
 * back. The author's own files are written exactly as generated: reformatting
 * someone's screen because a command happened to run is not armemon's call to make.
 *
 * Separate so `armemon plugin remove` can tell whether a file is still what armemon
 * wrote, by producing it again.
 */
export async function renderGeneratedFile(
  appRoot: string,
  file: PluginInstallPlan['filesToWrite'][number],
  options: { layout?: AppLayout } = {},
): Promise<string> {
  const managed =
    options.layout !== undefined && isManaged(options.layout, file.path) && FORMATTABLE.test(file.path);
  return managed ? formatGeneratedSource(file.content, path.join(appRoot, file.path)) : file.content;
}
