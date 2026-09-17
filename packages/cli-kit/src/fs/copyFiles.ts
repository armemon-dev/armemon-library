/**
 * FILE: copyFiles.ts
 * PATH: packages/cli-kit/src/fs/copyFiles.ts
 *
 * WHAT: Copies a batch of files into the scaffolded app, creating parent
 *       directories as needed.
 * WHY:  filesToWrite carries string content, which is fine for generated source and
 *       useless for a PNG. A splash logo has to physically land where the web build
 *       can serve it, and telling the user to copy it themselves is exactly the kind
 *       of leftover manual step armemon exists to remove.
 * HOW:  fs.copyFile per entry. A missing source is reported rather than silently
 *       skipped — it means the plan referenced something that isn't there, which the
 *       user needs to know about.
 * WHEN: Called by the init flow alongside writeGeneratedFiles.
 *
 * EXPORTS: copyGeneratedFiles
 * DEPENDS ON: node:path, node:fs/promises, @armemon-library/config-types
 * USED BY: packages/cli-armemon/src/flows/initReactNative.ts
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import type { PluginInstallPlan } from '@armemon-library/config-types';

export interface CopyResult {
  copied: string[];
  missing: string[];
}

export async function copyGeneratedFiles(
  appRoot: string,
  files: NonNullable<PluginInstallPlan['filesToCopy']>,
): Promise<CopyResult> {
  const copied: string[] = [];
  const missing: string[] = [];

  for (const file of files) {
    const from = path.isAbsolute(file.from) ? file.from : path.join(appRoot, file.from);
    const to = path.join(appRoot, file.to);

    const exists = await fs
      .access(from)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      missing.push(file.from);
      continue;
    }

    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(from, to);
    copied.push(file.to);
  }

  return { copied, missing };
}
