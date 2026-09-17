/**
 * FILE: registryVersions.ts
 * PATH: packages/cli-kit/src/exec/registryVersions.ts
 *
 * WHAT: Asks the npm registry which release of a platform package goes with a given
 *       React Native version.
 * WHY:  react-native-windows and react-native-macos track React Native's minor line
 *       (0.87.x of one pairs with 0.87.x of the other) but ship WEEKS OR MONTHS
 *       behind it, so the right answer is knowable but not guessable — and it
 *       changes over time, which rules out a table baked into this package.
 *
 *       Without it the only honest instruction was "npm install
 *       react-native-windows@^0.87.0", handed to the user to run and to get wrong:
 *       ^0.87.0 does not resolve today, and picking the fallback yourself means
 *       reading a version list and knowing that the newest release below your React
 *       Native minor is the one to take. That is exactly the work a tool should do.
 * HOW:  `npm view` against the registry — no extra dependency, and it inherits the
 *       user's registry, proxy and auth configuration for free. First the exact
 *       minor, then the newest release at or below it.
 * WHEN: Called by `armemon add <platform>` before installing, and by the init flow
 *       when it attaches a native target.
 *
 * EXPORTS: resolvePlatformPackageVersion, PlatformPackageResolution
 * DEPENDS ON: execa, semver
 * USED BY: packages/cli-armemon/src/flows/addPlatform.ts
 */

import { execa } from 'execa';
import semver from 'semver';

export interface PlatformPackageResolution {
  /** The range to install, e.g. "^0.84.0". */
  range: string;
  /** The concrete version that range resolves to right now. */
  version: string;
  /**
   * True when this release is behind the app's React Native minor, i.e. the exact
   * pairing does not exist yet. The build usually still works, with a peer warning.
   */
  behind: boolean;
}

async function npmView(args: string[]): Promise<unknown | null> {
  try {
    const { stdout } = await execa('npm', ['view', ...args, '--json'], { timeout: 60000 });
    return stdout.trim() === '' ? null : (JSON.parse(stdout) as unknown);
  } catch {
    // A range with no match exits non-zero. That is an answer, not a failure.
    return null;
  }
}

/** The highest version a `npm view` result describes, whether it returned one or many. */
function highest(result: unknown): string | null {
  if (typeof result === 'string') return result;
  if (Array.isArray(result)) {
    const versions = result.filter((entry): entry is string => typeof entry === 'string');
    return versions.length > 0 ? (versions.sort(semver.rcompare)[0] ?? null) : null;
  }
  return null;
}

/**
 * The release of `packageName` to install alongside React Native `rnVersion`.
 *
 * Returns null when the registry has nothing usable at all — the caller decides
 * whether that is fatal, since "no macOS release exists yet" is a reason to skip a
 * platform rather than to fail a scaffold.
 */
export async function resolvePlatformPackageVersion(
  packageName: string,
  rnVersion: string,
): Promise<PlatformPackageResolution | null> {
  const coerced = semver.coerce(rnVersion);

  // Without a concrete React Native version there is nothing to pair against, so
  // the newest release is the only defensible answer.
  if (!coerced) {
    const latest = highest(await npmView([`${packageName}@latest`, 'version']));
    return latest ? { range: `^${latest}`, version: latest, behind: false } : null;
  }

  const line = `${coerced.major}.${coerced.minor}`;
  const exact = highest(await npmView([`${packageName}@^${line}.0`, 'version']));
  if (exact) return { range: `^${line}.0`, version: exact, behind: false };

  // No release on that line yet. Take the newest one that is not ahead of it —
  // never a higher minor, which would pair the app with a React Native it doesn't
  // have.
  const all = await npmView([packageName, 'versions']);
  const candidates = (Array.isArray(all) ? all : [])
    .filter((entry): entry is string => typeof entry === 'string')
    .filter((version) => semver.valid(version) !== null && !semver.prerelease(version))
    .filter((version) => semver.lte(version, `${line}.0`) || semver.satisfies(version, `^${line}.0`))
    .sort(semver.rcompare);

  const best = candidates[0];
  if (!best) return null;

  const bestLine = semver.coerce(best);
  return {
    range: `^${best}`,
    version: best,
    behind: bestLine ? `${bestLine.major}.${bestLine.minor}` !== line : true,
  };
}
