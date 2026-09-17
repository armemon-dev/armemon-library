/**
 * FILE: questions.ts
 * PATH: packages/plugin-redux/src/wizard/questions.ts
 *
 * WHAT: The Redux Toolkit plugin's question flow — slice templates, AsyncStorage
 *       persistence, middlewares, DevTools, and per-template follow-up questions.
 * WHY:  This is the reference example the user gave verbatim ("complete setup with
 *       asyncStorage? root reducer name? middlewares? available slice templates?") —
 *       every other optional plugin's wizard follows this same depth/shape. The
 *       trailing dependency-version question (recommended/latest/custom) exists
 *       because caret ranges on RN-native packages (async-storage here) can drift to
 *       a version requiring a newer RN than the app was scaffolded with — asked only
 *       when the app didn't target "latest" RN, since there's no fixed known-good
 *       pin for a moving target.
 * HOW:  Slice-template selection is asked FIRST even though it's conceptually a
 *       "later" question, because the persistence whitelist question needs to offer
 *       exactly the slices that were chosen — asking in dependency order, not
 *       declaration order.
 * WHEN: Called once if the user selects the Redux Toolkit plugin during Step 4 of
 *       the init flow.
 *
 * EXPORTS: askReduxQuestions, ReduxAnswers, SliceTemplateId
 * DEPENDS ON: @armemon-library/cli-kit, @armemon-library/config-types
 * USED BY: packages/plugin-redux/src/wizard/index.ts
 */

import {
  promptConfirm,
  promptMultiselect,
  promptSelect,
  promptText,
  resolveDependencyVersions,
} from '@armemon-library/cli-kit';
import type { WizardContext } from '@armemon-library/config-types';

export type SliceTemplateId = 'counter' | 'auth' | 'user' | 'todos';

export interface ReduxAnswers {
  persistEnabled: boolean;
  persistKey: string;
  whitelist: SliceTemplateId[];
  middlewares: string[];
  devTools: 'auto' | 'on' | 'off';
  sliceTemplates: SliceTemplateId[];
  tokenName: string;
  useNanoid: boolean;
  storeVariableName: string;
  dependencyVersions: Record<string, string>;
}

export async function askReduxQuestions(ctx: WizardContext): Promise<ReduxAnswers> {
  const sliceTemplates = await promptMultiselect<SliceTemplateId>({
    message: 'Which starter slice templates would you like to scaffold?',
    options: [
      { value: 'counter', label: 'counter — basic sync reducers' },
      { value: 'auth', label: 'auth — async login/logout with createAsyncThunk' },
      { value: 'user', label: 'user — profile object CRUD' },
      { value: 'todos', label: 'todos — entity-array CRUD' },
    ],
    initialValues: ['counter'],
    // --all-accept is meant to produce a fully-loaded, demonstrable app, and
    // plugin-navigation forces its sample auth flow under the same flag. Taking
    // only the interactive default here left that flow on local state with a note
    // telling the user to pick the auth slice they'd just been given no chance to.
    allAcceptSelectsAll: true,
  });

  const persistEnabled = await promptConfirm({
    message: 'Set up Redux with full AsyncStorage persistence?',
    initialValue: true,
  });

  let persistKey = 'root';
  let whitelist: SliceTemplateId[] = [];

  if (persistEnabled) {
    persistKey = await promptText({
      message: 'Root persist key name?',
      placeholder: 'root',
      defaultValue: 'root',
      // Becomes an AsyncStorage key and is interpolated into generated source, so
      // quotes/newlines here would break the file outright.
      validate: (value) =>
        /^[A-Za-z0-9_.:-]{1,64}$/.test(value)
          ? undefined
          : 'Use 1-64 characters: letters, numbers, and _ . : - only.',
    });

    if (sliceTemplates.length > 0) {
      whitelist = await promptMultiselect<SliceTemplateId>({
        message: 'Whitelist which slices to persist?',
        options: sliceTemplates.map((id) => ({ value: id, label: id })),
        initialValues: sliceTemplates,
      });
    }
  }

  // redux-thunk is not offered: RTK includes it in the default middleware already,
  // so listing it as a choice was a label pretending to be an option.
  const middlewares = await promptMultiselect({
    message: 'Which middlewares? (redux-thunk is already included by Redux Toolkit)',
    options: [
      { value: 'redux-logger', label: 'redux-logger — dev-only action logging (wired for you)' },
      { value: 'custom', label: "I'll add my own in store.config.ts" },
    ],
    initialValues: [],
    required: false,
  });

  const devTools = await promptSelect({
    message: 'Enable Redux DevTools?',
    options: [
      { value: 'auto', label: 'Auto (on in dev, off in production)' },
      { value: 'on', label: 'Always on' },
      { value: 'off', label: 'Always off' },
    ],
    initialValue: 'auto',
  });

  let tokenName = 'token';
  if (sliceTemplates.includes('auth')) {
    tokenName = await promptText({
      message: 'Auth slice: token field name?',
      placeholder: 'token',
      defaultValue: 'token',
      // Interpolated straight into generated TypeScript as a property name.
      validate: (value) =>
        /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value)
          ? undefined
          : 'Must be a valid JavaScript identifier, e.g. token or accessToken.',
    });
  }

  let useNanoid = false;
  if (sliceTemplates.includes('todos')) {
    useNanoid = await promptConfirm({
      message: 'todos slice: use nanoid for generated ids? (declining falls back to Date.now())',
      initialValue: true,
    });
  }

  const storeVariableName = await promptText({
    message: 'Store variable name (cosmetic, used in generated comments/exports)?',
    placeholder: 'store',
    defaultValue: 'store',
    validate: (value) =>
      /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value)
        ? undefined
        : 'Must be a valid JavaScript identifier, e.g. store or appStore.',
  });

  const nativeDeps = ['@reduxjs/toolkit', 'react-redux'];
  if (persistEnabled) {
    nativeDeps.push('redux-persist', '@react-native-async-storage/async-storage');
  }
  const dependencyVersions = await resolveDependencyVersions(
    ctx.rnVersion,
    nativeDeps.map((packageName) => ({ packageName })),
  );

  return {
    persistEnabled,
    persistKey,
    whitelist,
    middlewares,
    devTools: devTools as ReduxAnswers['devTools'],
    sliceTemplates,
    tokenName,
    useNanoid,
    storeVariableName,
    dependencyVersions,
  };
}
