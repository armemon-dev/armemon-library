/**
 * FILE: dependencyVersions.ts
 * PATH: packages/cli-kit/src/prompts/dependencyVersions.ts
 *
 * WHAT: Resolves the npm version string each of a plugin's native dependencies
 *       should be pinned to — "latest" for everything when the app targets a moving
 *       or unverified React Native version, or a recommended/latest/custom choice
 *       the user makes once per plugin when a verified set exists for their exact
 *       RN minor.
 * WHY:  Centralizing this means each plugin's wizard asks one consistent question
 *       instead of reinventing the choice UI. The label is now derived from whether
 *       a verified set ACTUALLY exists for the requested RN version, not from
 *       interpolating whatever the user typed: the previous version promised
 *       "verified compatible with React Native <anything>" while always serving the
 *       0.76 pins, which is a claim nobody had checked for any other minor.
 * HOW:  resolveKnownGoodSet() decides. No verified set (or rnVersion === 'latest')
 *       => no "recommended" option is offered at all; the user picks latest or
 *       custom, and latest is the default. A verified set => the familiar three-way
 *       choice, defaulting to recommended.
 * WHEN: Called once per plugin wizard, after the plugin's own functional questions,
 *       for whichever native packages that plugin's plan() is about to add.
 *
 * EXPORTS: resolveDependencyVersions, DependencySpec
 * DEPENDS ON: ./select, ./text, ../versions/knownGoodVersions, ../logger
 * USED BY: plugin-redux, plugin-navigation, plugin-essentials, builtin-splash wizards
 */

import { promptSelect } from './select.js';
import { promptText } from './text.js';
import { logger } from '../logger.js';
import { resolveKnownGoodSet, verifiedRnMinors } from '../versions/knownGoodVersions.js';

export interface DependencySpec {
  packageName: string;
  /** Ignored when the target RN version has no verified set. */
  recommendedVersion?: string;
}

const SEMVER_OR_RANGE = /^(latest|next|\*|[~^]?\d+(\.\d+){0,2}(-[0-9A-Za-z.-]+)?)$/;

export async function resolveDependencyVersions(
  rnVersion: string,
  deps: DependencySpec[],
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};

  if (deps.length === 0) {
    return result;
  }

  const knownGood = rnVersion === 'latest' ? null : resolveKnownGoodSet(rnVersion);
  const names = deps.map((dep) => dep.packageName).join(', ');

  if (!knownGood) {
    // No verified set exists for this target. Say so once, then take "latest"
    // rather than pretending some other minor's pins were checked against it.
    if (rnVersion !== 'latest') {
      logger.warn(
        `No verified dependency set for React Native ${rnVersion} (verified: ${verifiedRnMinors().join(', ')}). Using "latest" for ${names} — pin them yourself if a native build fails.`,
      );
    }
    for (const dep of deps) result[dep.packageName] = 'latest';
    return result;
  }

  const strategy = await promptSelect({
    message: `Dependency versions for ${names}?`,
    options: [
      {
        value: 'recommended',
        label: `Recommended — verified together against React Native ${rnVersion}`,
      },
      { value: 'latest', label: 'Latest (may not be compatible with this React Native version)' },
      { value: 'custom', label: 'Custom — choose each version yourself' },
    ],
    initialValue: 'recommended',
  });

  if (strategy === 'recommended') {
    for (const dep of deps) {
      result[dep.packageName] =
        knownGood[dep.packageName] ?? dep.recommendedVersion ?? 'latest';
    }
    return result;
  }

  if (strategy === 'latest') {
    for (const dep of deps) result[dep.packageName] = 'latest';
    return result;
  }

  for (const dep of deps) {
    const fallback = knownGood[dep.packageName] ?? dep.recommendedVersion ?? 'latest';
    result[dep.packageName] = await promptText({
      message: `Version for ${dep.packageName}?`,
      placeholder: fallback,
      defaultValue: fallback,
      validate: (value) =>
        SEMVER_OR_RANGE.test(value.trim())
          ? undefined
          : 'Enter a version like 1.2.3, ^1.2.0, or "latest".',
    });
  }

  return result;
}
