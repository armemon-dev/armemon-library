/**
 * FILE: language.ts
 * PATH: packages/config-types/src/language.ts
 *
 * WHAT: The AppLanguage union — whether a scaffolded app is written in TypeScript
 *       or plain JavaScript.
 * WHY:  React Native has had no JavaScript template since 0.71; its CLI scaffolds
 *       TypeScript unconditionally and `--template` only takes a third-party
 *       package. So a JS app isn't something the RN CLI can produce — armemon has to
 *       convert what it generates and strip the TypeScript the template brought with
 *       it. That makes the language a first-class scaffold-time decision rather than
 *       something a plugin can infer, which is why it lives in the shared contract:
 *       every wizard sees it on WizardContext, and it's recorded in the app config.
 * HOW:  Plain string literal union, no runtime code.
 * WHEN: Chosen once during `armemon init`, then read by the file-writing layer and
 *       by any wizard whose questions only make sense in one language.
 *
 * EXPORTS: AppLanguage
 * DEPENDS ON: nothing
 * USED BY: packages/config-types/src/{wizard,appConfig}.ts, packages/cli-kit/src/fs/*
 */

export type AppLanguage = 'typescript' | 'javascript';
