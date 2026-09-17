/**
 * FILE: version.ts
 * PATH: packages/cli-armemon/src/version.ts
 *
 * WHAT: Reads this package's real version out of its own package.json.
 * WHY:  `program.version()` was given a hardcoded '0.0.0'. The moment changesets
 *       bumps the package, `armemon --version` reports a version the CLI isn't —
 *       an unfortunate failure mode in a tool whose entire job is managing versions,
 *       and one that makes every bug report's version line untrustworthy.
 * HOW:  createRequire against import.meta.url, walking up from the compiled file to
 *       the package root. Falls back to '0.0.0-unknown' rather than throwing: a
 *       missing package.json should never stop the CLI from running.
 * WHEN: Read once when the commander program is built.
 *
 * EXPORTS: getCliVersion
 * DEPENDS ON: node:module
 * USED BY: packages/cli-armemon/src/index.ts
 */

import { createRequire } from 'node:module';

const requireFromHere = createRequire(import.meta.url);

export function getCliVersion(): string {
  for (const specifier of ['../package.json', '../../package.json']) {
    try {
      const pkg = requireFromHere(specifier) as { name?: string; version?: string };
      // By name, so a package.json that isn't this one — the app's, the monorepo's —
      // is never reported as the CLI's version.
      if (pkg.name === '@armemon-library/cli' && pkg.version) return pkg.version;
    } catch {
      // Try the next candidate path.
    }
  }
  return '0.0.0-unknown';
}
