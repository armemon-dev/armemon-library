/**
 * FILE: generate.ts
 * PATH: packages/builtin-advanced-init/src/wizard/generate.ts
 *
 * WHAT: Turns AdvancedInitAnswers into a PluginInstallPlan — env file, `@env` type
 *       declarations, path aliases in both tsconfig and Babel, a bundle-id note when
 *       the answer differs from what the native projects actually contain, and an
 *       opinionated Prettier config if chosen.
 * WHY:  Four things this file used to get wrong.
 *
 *       Babel: the env branch OVERWROTE babel.config.js with only its own plugin
 *       while the path-alias branch asked the user to add module-resolver by hand —
 *       two features fighting over one file, one of them clobbering, one of them
 *       manual. Both now contribute to `babelPlugins`, which the CLI composes into a
 *       single config, so `@/` imports work at runtime and not just in the editor.
 *
 *       Dependencies: react-native-dotenv and babel-plugin-module-resolver are Babel
 *       plugins and were landing in the app's runtime `dependencies`. They go to
 *       `devDependencies` now that the plan contract has that channel.
 *
 *       Prettier: the "opinionated" config did `require('@react-native/prettier-
 *       config')`, which RN 0.76's template does not install — verified by
 *       require.resolve inside two real scaffolds, MODULE_NOT_FOUND in both, so every
 *       prettier run in the app failed. The values are inlined instead.
 *
 *       Bundle id: the "RN CLI default" it compared against was reconstructed as
 *       `org.reactjs.native.<appname>`, which matches neither platform. The real
 *       values are read off the generated native projects.
 *
 *       Renaming the bundle id across Xcode and Gradle is still a note: those are
 *       exactly the files where a bad regex costs someone a working project.
 * HOW:  Merges its path alias into tsconfig.json rather than writing the file; contributes
 *       Babel entries and gitignore lines rather than writing those files itself. Files the app owns
 *       once written (.env, a Prettier config someone chose) are marked so nothing
 *       writes over them, and what `armemon plugin remove` leaves behind is said in
 *       removalNotes.
 * WHEN: Called once by the wizard's plan() step.
 *
 * EXPORTS: planAdvancedInit
 * DEPENDS ON: node:path, node:fs/promises, @armemon-library/cli-kit, @armemon-library/config-types, ./questions
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { readNativeIdentifiers } from '@armemon-library/cli-kit';
import type { PluginInstallPlan, WizardContext } from '@armemon-library/config-types';
import type { AdvancedInitAnswers } from './questions.js';

export async function planAdvancedInit(
  answers: AdvancedInitAnswers,
  ctx: WizardContext,
): Promise<PluginInstallPlan> {
  const npmDependencies: Record<string, string> = {};
  const devDependencies: Record<string, string> = {};
  const filesToWrite: PluginInstallPlan['filesToWrite'] = [];
  const babelPlugins: string[] = [];
  const gitignoreEntries: string[] = [];
  const postInstallNotes: string[] = [];
  const removalNotes: string[] = [];
  const jsonMerges: NonNullable<PluginInstallPlan['jsonMerges']> = [];
  // Both features below work through Babel, which Metro runs and Vite doesn't. Said
  // again for the web target, or `@/` and `@env` imports fail only in `vite build`.
  const webContributions: NonNullable<PluginInstallPlan['webContributions']> = {};

  if (answers.envStrategy === 'react-native-dotenv') {
    // A Babel plugin, not a runtime dependency.
    devDependencies['react-native-dotenv'] = '^3.4.11';
    babelPlugins.push("['module:react-native-dotenv', { moduleName: '@env', path: '.env' }]");
    webContributions.envModules = { '@env': '.env' };

    // The example file is what a teammate opens to find out what the app needs, so
    // it carries the usage notes; .env itself stays a bare list of values.
    const declareStep =
      ctx.language === 'javascript'
        ? '#   3. That is all — JavaScript needs no declaration.'
        : "#   3. Declare it in src/types/env.d.ts, or TypeScript won't know the name:\n#        export const API_URL: string;";

    // Both are the app's from the moment they exist — they hold its real values — so
    // neither is ever written over, by init or by `armemon plugin add`.
    filesToWrite.push({
      path: '.env.example',
      whenPresent: 'keep',
      content: `# Environment variables, inlined at BUILD time by react-native-dotenv.
#
# ADDING ONE
#   1. Add it here (so the team knows it exists) and in .env (with a real value).
#   2. Import it by name from the virtual '@env' module:
#        import { API_URL } from '@env';
${declareStep}
#
# THE ONE GOTCHA
#   Values are compiled into the bundle by Babel, not read at runtime. After editing
#   .env, clear the cache or the old value stays baked in:
#     npm start -- --reset-cache
#
# NOT A SECRET STORE
#   Anything here ships inside the app and can be read back out of it. API base URLs,
#   feature flags and public client ids are fine; signing keys, and anything that can
#   spend money, are not — those belong behind your own backend.
#
# .env is gitignored; this file is not, so keep real values out of it.

API_URL=https://api.example.com

# The shape of what usually follows:
# API_TIMEOUT_MS=10000
# SENTRY_DSN=
# ENABLE_BETA_FEATURES=false
`,
    });

    // Written so the app starts with a usable .env rather than a Babel plugin
    // pointing at a file that doesn't exist.
    filesToWrite.push({
      path: '.env',
      whenPresent: 'keep',
      content: `# Your real values. Ignored by git — see .gitignore.
# What each variable is for, and how to add one: .env.example
API_URL=https://api.example.com
`,
    });

    // The RN template's .gitignore has no .env entry, so the first real secret put
    // in that file would have been committed.
    gitignoreEntries.push('.env', '.env.local', '.env.*.local');

    // Without this, `import { API_URL } from '@env'` is a type error in an app the
    // CLI just told to use exactly that import. A JavaScript app has no type
    // checker to satisfy, so the file would be dead weight.
    if (ctx.language !== 'javascript') {
      filesToWrite.push({
        path: 'src/types/env.d.ts',
      content: `/**
 * Type declarations for the virtual '@env' module react-native-dotenv creates.
 * Add one line per variable you put in .env.
 */
declare module '@env' {
  export const API_URL: string;
}
`,
      });
    }
  }

  if (answers.pathAliases) {
    // Merged, not written: only this key is the plugin's, so `armemon plugin remove`
    // can take exactly it back out. A JavaScript app has no tsconfig.json — armemon
    // removed it — so the Babel module-resolver entry below is the whole feature there.
    // No `baseUrl`: TypeScript 6 already errors on it (TS5101) and 7 removes it. `paths`
    // has resolved relative to the tsconfig's own directory since 4.4.
    if (ctx.language !== 'javascript') {
      jsonMerges.push({ path: 'tsconfig.json', values: { compilerOptions: { paths: { '@/*': ['./src/*'] } } } });
    }

    devDependencies['babel-plugin-module-resolver'] = '^5.0.2';
    // Contributed rather than described in a note: this is what makes `@/` resolve
    // at runtime instead of only in the editor.
    babelPlugins.push("['module-resolver', { root: ['./src'], alias: { '@': './src' } }]");
    webContributions.aliases = { '@': 'src' };
  }

  const actual = await readNativeIdentifiers(ctx.appRoot);
  const currentIds = [
    actual.ios ? `iOS ${actual.ios}` : null,
    actual.android ? `Android ${actual.android}` : null,
  ].filter(Boolean);
  const alreadyMatches =
    (!actual.ios || actual.ios === answers.bundleId) &&
    (!actual.android || actual.android === answers.bundleId);

  if (answers.bundleId && currentIds.length > 0 && !alreadyMatches) {
    postInstallNotes.push(
      `Bundle identifier: you chose "${answers.bundleId}", but the generated native projects currently use ${currentIds.join(' and ')}. armemon doesn't rewrite Xcode/Gradle project files (too easy to corrupt) — run "npx react-native-rename ${ctx.appName} -b ${answers.bundleId}", or edit ios/*.xcodeproj's PRODUCT_BUNDLE_IDENTIFIER and android/app/build.gradle's applicationId by hand.`,
    );
  }

  if (answers.lintStyle === 'opinionated') {
    // Replaces React Native's own .prettierrc.js, never a config someone wrote: added
    // to an app that already has its own style, the values are said instead.
    const prettierPath = path.join(ctx.appRoot, '.prettierrc.js');
    const existingPrettier = await fs.readFile(prettierPath, 'utf8').catch(() => null);
    const ownStyle =
      existingPrettier !== null &&
      !TEMPLATE_PRETTIER_CONFIGS.some((template) => sameConfig(template, existingPrettier)) &&
      !sameConfig(OPINIONATED_PRETTIER, existingPrettier);
    if (ownStyle) {
      postInstallNotes.push(
        `Your .prettierrc.js was left as it is. The opinionated style is: ${OPINIONATED_VALUES}.`,
      );
    }
    filesToWrite.push({
      path: '.prettierrc.js',
      whenPresent: ownStyle ? 'keep' : 'replace',
      content: OPINIONATED_PRETTIER,
    });
    removalNotes.push("The opinionated .prettierrc.js stays — it's how the code is formatted now.");
  }

  if (answers.envStrategy === 'react-native-dotenv') {
    removalNotes.push(
      '.env and .env.example stay, with your values in them — delete them yourself if you no longer need them. .gitignore keeps ignoring .env.',
    );
  }

  return {
    npmDependencies,
    devDependencies,
    filesToWrite,
    babelPlugins: babelPlugins.length > 0 ? babelPlugins : undefined,
    gitignoreEntries: gitignoreEntries.length > 0 ? gitignoreEntries : undefined,
    jsonMerges: jsonMerges.length > 0 ? jsonMerges : undefined,
    webContributions: Object.keys(webContributions).length > 0 ? webContributions : undefined,
    appEntryContributions: {
      providerImport: { importName: 'AdvancedInitPlugin', from: '@armemon-library/advanced-init' },
      registerInRuntimeConfig: true,
    },
    postInstallNotes: postInstallNotes.length > 0 ? postInstallNotes : undefined,
    removalNotes: removalNotes.length > 0 ? removalNotes : undefined,
  };
}

/**
 * The .prettierrc.js React Native's template ships, by release: 0.76, then 0.87.
 * Only these are replaced — anything else is somebody's decision.
 */
const TEMPLATE_PRETTIER_CONFIGS = [
  `module.exports = {
  arrowParens: 'avoid',
  bracketSameLine: true,
  bracketSpacing: false,
  singleQuote: true,
  trailingComma: 'all',
};
`,
  `module.exports = {
  arrowParens: 'avoid',
  singleQuote: true,
  trailingComma: 'all',
};
`,
];

const OPINIONATED_VALUES =
  "arrowParens 'avoid', bracketSameLine true, bracketSpacing false, singleQuote true, trailingComma 'all', printWidth 100";

/** Two configs that differ only in whitespace, quotes, comments and trailing commas. */
function sameConfig(a: string, b: string): boolean {
  const normal = (text: string) =>
    text
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, '')
      .replace(/"/g, "'")
      .replace(/,(?=[\]}])/g, '');
  return normal(a) === normal(b);
}

const OPINIONATED_PRETTIER = `// Values are inlined rather than spread from '@react-native/prettier-config':
// React Native 0.76's template doesn't install that package, so requiring it made
// every prettier run in the app fail with MODULE_NOT_FOUND.
module.exports = {
  arrowParens: 'avoid',
  bracketSameLine: true,
  bracketSpacing: false,
  singleQuote: true,
  trailingComma: 'all',
  printWidth: 100,
};
`;
