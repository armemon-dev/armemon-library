/**
 * FILE: index.ts
 * PATH: packages/cli-kit/src/index.ts
 *
 * WHAT: Public entry point for @armemon-library/cli-kit — re-exports the logger, shell-out
 *       helpers, prompt wrappers, plugin discovery, templating, fs patchers, and
 *       runtime codegen.
 * WHY:  Gives the CLI and every plugin wizard a single import path instead of
 *       reaching into individual files.
 * HOW:  Barrel re-export.
 * WHEN: Imported wherever any cli-kit primitive is needed.
 *
 * EXPORTS: everything from ./logger, ./errors, ./preflight, ./exec/*, ./prompts/*,
 *          ./discovery/*, ./templating/engine, ./fs/*,
 *          ./codegen/runtimeConfigGenerator, ./versions/*
 * DEPENDS ON: all sibling modules under src/
 * USED BY: packages/cli-armemon/**, every plugin's wizard
 */

export * from './logger.js';
export * from './errors.js';
export * from './preflight.js';
export * from './verify.js';
export * from './exec/rnCli.js';
export * from './exec/packageManager.js';
export * from './exec/childOutput.js';
export * from './exec/registryVersions.js';
export * from './exec/rnWindowsCli.js';
export * from './exec/rnMacosCli.js';
export * from './exec/webScaffold.js';
export * from './prompts/text.js';
export * from './prompts/select.js';
export * from './prompts/confirm.js';
export * from './prompts/multiselect.js';
export * from './prompts/spinner.js';
export * from './prompts/dependencyVersions.js';
export * from './prompts/autoAccept.js';
export * from './prompts/cancel.js';
export * from './versions/knownGoodVersions.js';
export * from './discovery/manifestReader.js';
export * from './discovery/pluginRegistry.js';
export * from './discovery/projectPlugins.js';
export * from './discovery/resolveLocalPackage.js';
export * from './templating/engine.js';
export * from './fs/layout.js';
export * from './fs/configFile.js';
export * from './fs/packageJsonPatcher.js';
export * from './fs/packageJsonScripts.js';
export * from './fs/appEntryPatcher.js';
export * from './fs/writeFiles.js';
export * from './fs/copyFiles.js';
export * from './fs/metroConfigPatcher.js';
export * from './fs/npmrcWriter.js';
export * from './fs/platformCleanup.js';
export * from './fs/packageManagerOverrides.js';
export * from './fs/babelConfigPatcher.js';
export * from './fs/indexEntryPatcher.js';
export * from './fs/gitignorePatcher.js';
export * from './fs/htmlPatcher.js';
export * from './fs/jestSetupWriter.js';
export * from './fs/nativeIdentifiers.js';
export * from './fs/sourceEdit.js';
export * from './fs/patchResult.js';
export * from './fs/arrayLiteralEdit.js';
export * from './fs/runtimeGeneratedPatcher.js';
export * from './fs/viteConfigPatcher.js';
export * from './fs/jsonMerge.js';
export * from './fs/specifierRewrite.js';
export * from './fs/navigatorPatcher.js';
export * from './fs/storeConfigPatcher.js';
export * from './fs/navigationDiscovery.js';
export * from './fs/routeReferences.js';
export * from './fs/languageConversion.js';
export * from './fs/typescriptRemoval.js';
export * from './codegen/runtimeConfigGenerator.js';
export * from './codegen/platformGuide.js';
export * from './codegen/screenScaffold.js';
export * from './codegen/sliceScaffold.js';
export * from './codegen/componentScaffold.js';
export * from './codegen/managedReadme.js';
