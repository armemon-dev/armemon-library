/**
 * FILE: generate.ts
 * PATH: packages/plugin-redux/src/wizard/generate.ts
 *
 * WHAT: Turns ReduxAnswers into a PluginInstallPlan — renders chosen slice
 *       templates, writes store.config.ts (plain data) and a per-app glue file
 *       (armemon/redux/index.ts) that calls configureReduxPlugin() with that
 *       data.
 * WHY:  configureReduxPlugin is a factory, not a static object (see runtime/index.tsx)
 *       because the store genuinely differs per app; the glue file is what turns
 *       "app-specific data" + "package's generic factory" into the fixed-name export
 *       (ReduxPlugin) runtime.generated.ts actually imports — this plan() reports
 *       exactly that import path back via appEntryContributions so the init flow's
 *       codegen step doesn't need any Redux-specific knowledge.
 * HOW:  Slice templates are read from this package's own templates/slices/*.ts.tmpl
 *       (resolved relative to this compiled file, since they ship alongside dist/ in
 *       the published package) and rendered via @armemon-library/cli-kit's renderTemplate.
 * WHEN: Called once by the wizard's plan() step, after askReduxQuestions() resolves.
 *
 * EXPORTS: planRedux
 * DEPENDS ON: node:path, node:fs/promises, node:url, @armemon-library/cli-kit,
 *             @armemon-library/config-types, ./questions
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { renderTemplate } from '@armemon-library/cli-kit';
import {
  SLICES_DIR,
  layoutOf,
  managedFile,
  managedPath,
  specifierFor,
  type PluginInstallPlan,
  type WizardContext,
} from '@armemon-library/config-types';
import type { ReduxAnswers, SliceTemplateId } from './questions.js';

const TEMPLATES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates', 'slices');

const SLICE_TEMPLATE_FILES: Record<SliceTemplateId, string> = {
  counter: 'counterSlice.ts.tmpl',
  auth: 'authSlice.ts.tmpl',
  user: 'userSlice.ts.tmpl',
  todos: 'todosSlice.ts.tmpl',
};

async function renderSliceFile(
  templateId: SliceTemplateId,
  answers: ReduxAnswers,
  storeConfigPath: string,
): Promise<{ path: string; content: string }> {
  const templateFile = SLICE_TEMPLATE_FILES[templateId];
  const source = await fs.readFile(path.join(TEMPLATES_DIR, templateFile), 'utf8');
  const outputFileName = templateFile.replace(/\.tmpl$/, '');
  // Slices are your domain state, not armemon's wiring: armemon writes one from a
  // template and never reads it again, so they live in your zone — the managed store
  // config just imports them. `armemon create-slice` puts new ones here too.
  const outputPath = `${SLICES_DIR}/${outputFileName}`;

  const tokens: Record<string, string> = {
    sliceFilePath: outputPath,
    // The slice lives in the author's zone and the store config in the managed one,
    // so the header can't name a fixed path: it moved once already.
    storeConfigPath,
    tokenName: answers.tokenName,
    idGenerator: answers.useNanoid ? "Redux Toolkit's nanoid" : 'Date.now()',
    // nanoid comes from @reduxjs/toolkit, never the standalone nanoid package:
    // nanoid v5's main entry needs crypto.getRandomValues(), which Hermes doesn't
    // provide, so a generated todos slice using it threw on the first add().
    // RTK ships an RN-safe implementation and is already a dependency.
    idGeneratorImport: answers.useNanoid ? '@armemon-library/redux (nanoid)' : 'nothing',
    idGeneratorImportStatement: answers.useNanoid
      ? "import { nanoid } from '@armemon-library/redux';"
      : '',
    idGeneratorCall: answers.useNanoid ? 'nanoid()' : 'Date.now().toString()',
  };

  return { path: outputPath, content: renderTemplate(source, tokens) };
}

export async function planRedux(answers: ReduxAnswers, ctx: WizardContext): Promise<PluginInstallPlan> {
  const filesToWrite: PluginInstallPlan['filesToWrite'] = [];
  const npmDependencies: Record<string, string> = { ...answers.dependencyVersions };

  const layout = layoutOf(ctx);
  const storeConfigPath = managedFile.storeConfig(layout);

  for (const templateId of answers.sliceTemplates) {
    filesToWrite.push(await renderSliceFile(templateId, answers, storeConfigPath));
  }

  const sliceFile = (id: SliceTemplateId) =>
    `${SLICES_DIR}/${SLICE_TEMPLATE_FILES[id].replace(/\.tmpl$/, '')}`;
  const sliceImports = answers.sliceTemplates
    .map((id) => `import { ${id}Slice } from '${specifierFor(storeConfigPath, sliceFile(id))}';`)
    .join('\n');
  // Four spaces: these lines sit inside `slices: {`, which is itself indented two.
  const sliceEntries = answers.sliceTemplates.map((id) => `    ${id}: ${id}Slice,`).join('\n');

  const devDependencies: Record<string, string> = {};
  const postInstallNotes: string[] = [];

  // redux-logger is wired here rather than described in a note. It only needs to be
  // appended to the default middleware array, which the `middleware` hook does.
  //
  // Imported statically, NOT via require(). A conditional `require('redux-logger')`
  // works under Metro and throws "ReferenceError: require is not defined" the
  // instant the same file is loaded by Vite for the web target — during module
  // evaluation, before React mounts, so the app's error boundary never sees it and
  // the page is simply blank. A static import is the only form both bundlers
  // understand; __DEV__ still gates whether the middleware is actually applied, and
  // a production bundler drops the dead branch.
  const middlewareLines: string[] = [];
  let loggerImport = '';
  if (answers.middlewares.includes('redux-logger')) {
    // A real dependency, not a devDependency: app source imports it statically, so
    // it has to resolve in any build that touches this file.
    npmDependencies['redux-logger'] = '^3.0.6';
    devDependencies['@types/redux-logger'] = '^3.0.13';
    loggerImport = "import reduxLogger from 'redux-logger';\n";
    middlewareLines.push(
      '  middleware: (defaultMiddleware) =>',
      '    __DEV__ ? [...defaultMiddleware, reduxLogger] : defaultMiddleware,',
    );
  }
  if (answers.middlewares.includes('custom')) {
    postInstallNotes.push(
      `Add your own middleware via the \`middleware\` field in ${managedFile.storeConfig(layoutOf(ctx))}.`,
    );
  }
  const middlewareBlock = middlewareLines.length > 0 ? `${middlewareLines.join('\n')}\n` : '';

  // The persist adapter is imported from a SEPARATE entry point, and only when
  // persistence is on. That import is the single thing that pulls redux-persist and
  // AsyncStorage into the bundle — keeping it out of the main runtime is what lets
  // an app that declined persistence build without those packages installed at all.
  const persistImport = answers.persistEnabled
    ? "import { persistAdapter } from '@armemon-library/redux/persist';\n"
    : '';
  const persistBlock = answers.persistEnabled
    ? `  persist: {
    enabled: true,
    key: '${answers.persistKey}',
    whitelist: [${answers.whitelist.map((name) => `'${name}'`).join(', ')}],
    adapter: persistAdapter,
  },`
    : '  persist: { enabled: false },';

  filesToWrite.push({
    path: storeConfigPath,
    content: `import type { ReduxConfig } from '@armemon-library/redux';
${persistImport}${loggerImport}${sliceImports}

/**
 * Your Redux store, as plain data.
 *
 * Every option this file accepts is below — the ones you chose are active, the rest
 * are commented out with an explanation. Uncomment what you want; you shouldn't need
 * to look anything up.
 */
export const reduxConfig: ReduxConfig = {
  // ---------------------------------------------------------------------------
  // slices — the reducers in your store. The key is the name in state, so
  // \`slices: { counter: ... }\` reads as \`state.counter\`.
  //
  // Two authoring styles are accepted:
  //   1. A plain object — { name, initialState, reducers } — passed to
  //      createSlice for you. Simplest, and enough for synchronous state.
  //      See ${SLICES_DIR}/counterSlice for one of these.
  //   2. A finished createSlice() result, detected by its \`.reducer\`. Needed
  //      when you use extraReducers to react to createAsyncThunk lifecycle
  //      actions. See ${SLICES_DIR}/authSlice.
  //
  // armemon create-slice Cart writes the slice and adds both lines below for you.
  // By hand: create the file, import it above, add a line here.
  //   import { cartSlice } from '${specifierFor(storeConfigPath, `${SLICES_DIR}/cartSlice.ts`)}';
  //   cart: cartSlice,
  // ---------------------------------------------------------------------------
  slices: {
${sliceEntries}
  },

  // ---------------------------------------------------------------------------
  // persist — save the store to AsyncStorage and restore it on next launch.
  //
  //   enabled    turn persistence on or off entirely
  //   key        the AsyncStorage key everything is stored under
  //   whitelist  ONLY these slices are saved (omit to save everything)
  //   blacklist  save everything EXCEPT these (don't use with whitelist)
  //   version    bump when a slice's shape changes, to discard stale saved state
  //   adapter    supplied by armemon; do not remove it
  //
  // The adapter import at the top of this file is the only thing that pulls
  // redux-persist and AsyncStorage into your bundle. Turning persistence off means
  // deleting that import too, or the packages are still bundled.
  //
  //   persist: {
  //     enabled: true,
  //     key: 'root',
  //     blacklist: ['ui'],   // everything except the \`ui\` slice
  //     version: 2,
  //     adapter: persistAdapter,
  //   },
  // ---------------------------------------------------------------------------
${persistBlock}

  // ---------------------------------------------------------------------------
  // devTools — connect to the Redux DevTools browser/Flipper extension.
  //   __DEV__  on in development, off in production builds (recommended)
  //   true     always on — do not ship this, it exposes your whole state
  //   false    always off
  // ---------------------------------------------------------------------------
  devTools: ${answers.devTools === 'auto' ? '__DEV__' : answers.devTools === 'on'},

  // ---------------------------------------------------------------------------
  // middleware — receives Redux Toolkit's default middleware array and returns the
  // final one. Order matters: middleware runs left to right.
  //
  // redux-thunk is already in the defaults, so async thunks work with no setup.
  //
  //   // add a logger in development only
  //   middleware: (defaultMiddleware) =>
  //     __DEV__ ? [...defaultMiddleware, reduxLogger] : defaultMiddleware,
  //
  //   // your own middleware
  //   const crashReporter = (store) => (next) => (action) => {
  //     try { return next(action); } catch (error) { report(error); throw error; }
  //   };
  //   middleware: (defaultMiddleware) => [...defaultMiddleware, crashReporter],
  //
  //   // drop a default you don't want (rare)
  //   middleware: (defaultMiddleware) =>
  //     defaultMiddleware.filter((mw) => mw.name !== 'immutableStateInvariant'),
  // ---------------------------------------------------------------------------
${middlewareBlock}};

/**
 * Using the store in a component:
 *
 *   import { useSelector, useDispatch } from '@armemon-library/redux';
 *   import { counterSlice } from '${specifierFor(storeConfigPath, `${SLICES_DIR}/counterSlice.ts`)}';
 *
 *   const value = useSelector((state) => state.counter.value);
 *   const dispatch = useDispatch();
 *   dispatch({ type: 'counter/increment' });
 *
 * @armemon-library/redux also re-exports createSlice, createAsyncThunk and nanoid
 * from Redux Toolkit, so your slice files need only one import. Use that nanoid
 * rather than the standalone package — the standalone one needs crypto APIs
 * React Native's engine doesn't provide.
 */
`,
  });

  filesToWrite.push({
    path: managedFile.reduxGlue(layout),
    content: `import { configureReduxPlugin } from '@armemon-library/redux';
import { reduxConfig } from './store.config';

/**
 * Glue file: turns ./store.config into the plugin object armemon.config registers.
 * The store itself is described in ./store.config — edit that, not this.
 *
 * configureReduxPlugin(config) builds the store, wraps your app in <Provider>, and
 * (when persistence is on) in <PersistGate>.
 *
 * OUTSIDE REACT — an API client, an init task, a push handler — reach the store
 * through this export:
 *
 *   import { ReduxPlugin } from './${managedPath(layout, 'redux')}';
 *
 *   ReduxPlugin.store.getState().auth.token;
 *   ReduxPlugin.store.dispatch({ type: 'counter/increment' });
 *   ReduxPlugin.store.subscribe(() => {});${
   answers.persistEnabled
     ? `
 *   ReduxPlugin.persistor.purge();          // wipe persisted state, e.g. on logout`
     : `
 *
 * ReduxPlugin.persistor is undefined here: persistence is off in ./store.config, so
 * no persistor was built. Turn persistence on and it becomes redux-persist's, with
 * .purge(), .flush() and .pause().`
 }
 *
 * INSIDE COMPONENTS use the hooks — they re-render when the state changes, which
 * getState() does not:
 *
 *   import { useSelector, useDispatch, useStore } from '@armemon-library/redux';
 *${
   ctx.language === 'javascript'
     ? ''
     : `
 * Typing the hooks against your own store:
 *
 *   export type RootState = ReturnType<typeof ReduxPlugin.store.getState>;
 *   export type AppDispatch = typeof ReduxPlugin.store.dispatch;
 *`
 }/
export const ReduxPlugin = configureReduxPlugin(reduxConfig);
`,
  });

  return {
    npmDependencies,
    devDependencies,
    filesToWrite,
    appEntryContributions: {
      providerImport: { importName: 'ReduxPlugin', from: './redux/index' },
      registerInRuntimeConfig: true,
    },
    postInstallNotes: postInstallNotes.length > 0 ? postInstallNotes : undefined,
  };
}
