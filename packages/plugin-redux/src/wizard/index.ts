/**
 * FILE: index.ts
 * PATH: packages/plugin-redux/src/wizard/index.ts
 *
 * WHAT: The PluginWizard implementation for the Redux Toolkit plugin.
 * WHY:  This is the `./wizard` export the init flow dynamically imports and drives
 *       when the user selects Redux Toolkit during Step 4.
 * HOW:  Thin composition of askReduxQuestions() + planRedux().
 * WHEN: Invoked once if Redux Toolkit is selected, during Step 5 of the init flow.
 *
 * EXPORTS: reduxWizard (also as default — the init flow dynamically imports every
 *          plugin's `./wizard` entry and expects the default export uniformly)
 * DEPENDS ON: @armemon-library/config-types, ./questions, ./generate
 * USED BY: packages/cli-armemon/src/flows/initReactNative.ts
 */

import type { PluginWizard } from '@armemon-library/config-types';
import { askReduxQuestions, type ReduxAnswers } from './questions.js';
import { planRedux } from './generate.js';

export const reduxWizard: PluginWizard<ReduxAnswers> = {
  pluginId: 'redux',
  intro: 'Redux Toolkit — state management with optional AsyncStorage persistence.',
  run: askReduxQuestions,
  plan: planRedux,
};

export default reduxWizard;
