/**
 * FILE: packageManager.ts
 * PATH: packages/config-types/src/packageManager.ts
 *
 * WHAT: The PackageManager union type — which package manager a scaffolded app uses.
 * WHY:  Lives in config-types (not cli-kit, where the actual detect/install logic
 *       lives) because WizardContext and ArmemonAppConfig both need this type and
 *       config-types is meant to be the dependency-free base layer everything else
 *       builds on — cli-kit imports this back rather than config-types depending on
 *       cli-kit, which would invert the intended dependency direction.
 * HOW:  Plain string literal union, no runtime code.
 * WHEN: Read wherever a package manager choice needs to be typed — WizardContext,
 *       ArmemonAppConfig, cli-kit's detect/install functions.
 *
 * EXPORTS: PackageManager
 * DEPENDS ON: nothing
 * USED BY: packages/config-types/src/wizard.ts, ./appConfig.ts, packages/cli-kit/src/exec/packageManager.ts
 */

export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun';
