/**
 * FILE: knownGoodVersions.ts
 * PATH: packages/cli-kit/src/versions/knownGoodVersions.ts
 *
 * WHAT: A per-React-Native-minor lookup of npm package versions verified to work
 *       together, plus the resolver that decides whether a verified set exists for
 *       the version the user actually asked for.
 * WHY:  Caret ranges on RN-native packages with their own Fabric view-config codegen
 *       (react-native-screens, safe-area-context, gesture-handler, reanimated,
 *       bootsplash) drift to newer minors/patches over time even within the "same"
 *       range — confirmed the hard way: `^4.5.0` for react-native-screens resolved to
 *       4.27.0 on a fresh install and threw "codegen: Unknown prop type" against RN
 *       0.76, even though 4.5.0 itself (same major, same caret range) is proven
 *       working. A caret here is not actually a pin, it's a live bug waiting for the
 *       registry to publish the next incompatible minor — so every package in this
 *       table that generates its own native view-config schema is EXACT-pinned, not
 *       caret-ranged.
 *
 *       This is keyed BY RN MINOR rather than being one flat map, because the flat
 *       map version silently lied: the dependency-version prompt interpolated
 *       whatever version the user typed into the label "verified compatible with
 *       React Native X" while always serving the 0.76 pins. A user targeting 0.72 or
 *       0.81 was told their versions were verified when nobody had ever checked. Now
 *       an unknown minor resolves to `null` and the prompt says so instead.
 * HOW:  KNOWN_GOOD_VERSIONS maps "<major>.<minor>" to its verified package set.
 *       resolveKnownGoodSet() normalizes a full semver ("0.76.3") to its minor key
 *       and returns null when that minor has no verified set — callers must handle
 *       null by offering "latest" rather than inventing a recommendation.
 * WHEN: Read once per plugin wizard's dependency-version question.
 *
 * EXPORTS: KNOWN_GOOD_VERSIONS, RN_076_KNOWN_GOOD_VERSIONS, KnownGoodSet,
 *          rnMinorKey, resolveKnownGoodSet, verifiedRnMinors
 * DEPENDS ON: semver
 * USED BY: packages/cli-kit/src/prompts/dependencyVersions.ts, every plugin's wizard
 */

import semver from 'semver';

export type KnownGoodSet = Record<string, string>;

/**
 * RN 0.76.x. Sourced from `testingApp` (a real, actively-run RN 0.76.0 app) where
 * available — that's live proof the exact pairing works, more reliable than a
 * published compatibility table. Packages testingApp doesn't use (bottom-tabs,
 * drawer, gesture-handler, reanimated, bootsplash) are exact-pinned to the version
 * researched as RN-0.76-compatible, without a live-app proof point. Pure-JS packages
 * with no native view-config surface keep caret ranges — they can't hit this specific
 * codegen failure mode, and a caret lets them pick up compatible patch fixes.
 */
const RN_076: KnownGoodSet = {
  react: '18.3.1',
  'react-native': '0.76.0',

  // Redux stack — versions from testingApp/package.json
  '@reduxjs/toolkit': '^2.0.0',
  'react-redux': '^9.0.0',
  'redux-persist': '^6.0.0',
  '@react-native-async-storage/async-storage': '^1.24.0',

  // Network — from testingApp/package.json
  '@react-native-community/netinfo': '^11.4.1',

  // Navigation — @react-navigation/native + native-stack from testingApp/package.json
  // (testingApp proves the v7 line, not v6, works with RN 0.76.0)
  '@react-navigation/native': '^7.0.14',
  '@react-navigation/native-stack': '^7.2.0',
  // Not present in testingApp (it only uses native-stack) — pinned to the same v7
  // line on the assumption that same-major React Navigation packages are designed
  // to interoperate; no live-app proof point for these two specifically.
  '@react-navigation/bottom-tabs': '^7.0.0',
  '@react-navigation/drawer': '^7.0.0',

  // react-native-screens 4.5.0 is what testingApp actually has installed and
  // running on RN 0.76.0. Exact-pinned: `^4.5.0` was confirmed to drift to a
  // broken 4.27.0 on a fresh install.
  'react-native-screens': '4.5.0',
  'react-native-safe-area-context': '5.1.0',

  // Drawer-only deps — no live-app proof point; pinned to the exact version
  // researched as RN-0.76-compatible (gesture-handler 3.x requires RN 0.82+,
  // reanimated 4.x requires RN 0.78+, so both must stay below these majors).
  'react-native-gesture-handler': '2.20.2',
  'react-native-reanimated': '3.16.1',

  // Fabric-component package (same codegen-drift risk class), exact-pinned.
  'react-native-bootsplash': '6.3.0',
};

export const KNOWN_GOOD_VERSIONS: Record<string, KnownGoodSet> = {
  '0.76': RN_076,
};

/** Retained under its original name so existing imports keep resolving. */
export const RN_076_KNOWN_GOOD_VERSIONS = RN_076;

/** "0.76.3" -> "0.76". Returns null for "latest" or anything unparseable. */
export function rnMinorKey(rnVersion: string): string | null {
  const coerced = semver.valid(rnVersion) ?? semver.valid(semver.coerce(rnVersion) ?? '');
  if (!coerced) return null;
  return `${semver.major(coerced)}.${semver.minor(coerced)}`;
}

/** Every RN minor this table has actually verified, newest first. */
export function verifiedRnMinors(): string[] {
  return Object.keys(KNOWN_GOOD_VERSIONS).sort((a, b) =>
    semver.rcompare(semver.coerce(a) ?? '0.0.0', semver.coerce(b) ?? '0.0.0'),
  );
}

/**
 * The verified set for this RN version, or null when nobody has verified it.
 * Never falls back to a different minor's pins silently — that's the bug this
 * function exists to prevent.
 */
export function resolveKnownGoodSet(rnVersion: string): KnownGoodSet | null {
  const key = rnMinorKey(rnVersion);
  if (!key) return null;
  return KNOWN_GOOD_VERSIONS[key] ?? null;
}
