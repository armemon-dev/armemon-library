/**
 * FILE: constants.ts
 * PATH: packages/cli-armemon/src/constants.ts
 *
 * WHAT: CLI-wide constants — the default React Native version, the v1 plugin
 *       catalog, and which host operating systems can BUILD which platform.
 * WHY:  Adding a plugin or bumping the default RN version stays a one-line change
 *       here rather than a grep across the flow. Each catalog package is also a real
 *       dependency of cli-armemon so Node can resolve its manifest and `./wizard`
 *       export; third-party plugins named with --plugins are resolved from the
 *       user's own project instead (see cli-kit's manifestReader).
 *
 *       The catalog is no longer order-sensitive. Wizard order used to be this
 *       array's order, and plugin-navigation had to come after plugin-redux because
 *       its sample-auth flow reads Redux's answers — a load-bearing ordering
 *       enforced only by a comment warning not to tidy the array. Plugins declare
 *       `armemon.dependsOn` in their own package.json now and the CLI sorts
 *       topologically, so this list can be reordered freely.
 * HOW:  Plain exported constants.
 * WHEN: Read by the init flow when resolving the RN version, discovering plugins,
 *       and filtering platforms against the host OS.
 *
 * EXPORTS: DEFAULT_RN_VERSION, BUILT_IN_PLUGIN_PACKAGES, BUILT_IN_PACKAGES,
 *          CATALOG_PACKAGES, BUILT_IN_PLUGIN_IDS, PLATFORM_BUILD_HOSTS, PLATFORM_PACKAGES, ALL_PLATFORMS,
 *          platformBuildableOnHost
 * DEPENDS ON: @armemon-library/config-types
 * USED BY: packages/cli-armemon/src/flows/initReactNative.ts, src/commands/*
 */

import type { Platform } from '@armemon-library/config-types';

export const DEFAULT_RN_VERSION = '0.76.0';

export const BUILT_IN_PLUGIN_PACKAGES = [
  '@armemon-library/redux',
  '@armemon-library/navigation',
  '@armemon-library/essentials',
  '@armemon-library/ui',
] as const;

export const BUILT_IN_PACKAGES = [
  '@armemon-library/splash',
  '@armemon-library/advanced-init',
] as const;

export const CATALOG_PACKAGES: string[] = [...BUILT_IN_PACKAGES, ...BUILT_IN_PLUGIN_PACKAGES];

/** The ids of the plugins above — what `armemon plugin add` takes. */
export const BUILT_IN_PLUGIN_IDS = ['splash', 'advanced-init', 'redux', 'navigation', 'essentials', 'ui'] as const;

export const ALL_PLATFORMS: Platform[] = ['ios', 'android', 'web', 'windows', 'macos'];

/**
 * The host OS each platform needs in order to BUILD — not to scaffold.
 *
 * The distinction is load-bearing and was originally got wrong here: these were
 * treated as "can only be attached from their own OS" and hidden from the platform
 * list on every other host. That's false. Verified by running it: on Linux,
 * `react-native init-windows` and `react-native-macos-init` both complete and
 * produce real windows/ and macos/ folders — react-native-macos even self-installs
 * its own matching version. Only compiling them needs Xcode or Visual Studio, which
 * is a later step on someone else's machine or in CI.
 *
 * So this map is now advisory: it drives a hint and a warning, and it keeps
 * --all-accept to platforms this host can finish end-to-end. It does not gate what a
 * user may deliberately choose.
 */
export const PLATFORM_BUILD_HOSTS: Partial<Record<Platform, NodeJS.Platform>> = {
  macos: 'darwin',
  windows: 'win32',
};

/**
 * The npm package each platform's target needs, so a platform that fails to attach
 * can take its dependency back out with it. iOS, Android and web need nothing extra
 * beyond what the base template and the web scaffold already install.
 */
export const PLATFORM_PACKAGES: Partial<Record<Platform, string[]>> = {
  windows: ['react-native-windows'],
  macos: ['react-native-macos'],
};

/** True when this host can build the platform, not merely scaffold it. */
export function platformBuildableOnHost(platform: Platform): boolean {
  const required = PLATFORM_BUILD_HOSTS[platform];
  return required === undefined || process.platform === required;
}
