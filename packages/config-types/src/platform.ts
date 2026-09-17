/**
 * FILE: platform.ts
 * PATH: packages/config-types/src/platform.ts
 *
 * WHAT: The Platform union type — which target platforms a scaffolded app builds
 *       for.
 * WHY:  Shared across the platform-selection question, the cleanup/scaffold
 *       functions in cli-kit, and ArmemonAppConfig — lives in config-types for the
 *       same dependency-direction reason as PackageManager (see ./packageManager.ts).
 * HOW:  Plain string literal union, no runtime code.
 * WHEN: Read wherever a platform choice needs to be typed.
 *
 * EXPORTS: Platform
 * DEPENDS ON: nothing
 * USED BY: packages/config-types/src/appConfig.ts, packages/cli-kit/src/fs/platformCleanup.ts,
 *          packages/cli-kit/src/exec/{rnWindowsCli,rnMacosCli,webScaffold}.ts,
 *          packages/cli-armemon/src/flows/initReactNative.ts
 */

export type Platform = 'ios' | 'android' | 'web' | 'windows' | 'macos';
