/**
 * FILE: index.ts
 * PATH: packages/plugin-ui/src/wizard/index.ts
 *
 * WHAT: The PluginWizard implementation for the UI Theming Kit plugin.
 * WHY:  This is the `./wizard` export the init flow dynamically imports and drives
 *       when the user selects UI Theming Kit during Step 4.
 * HOW:  Thin composition of askUiQuestions() + planUi().
 * WHEN: Invoked once if UI Theming Kit is selected, during Step 5 of the init flow.
 *
 * EXPORTS: uiWizard (also as default — the init flow dynamically imports every
 *          plugin's `./wizard` entry and expects the default export uniformly)
 * DEPENDS ON: @armemon-library/config-types, ./questions, ./generate
 * USED BY: packages/cli-armemon/src/flows/initReactNative.ts
 */

import type { PluginWizard } from '@armemon-library/config-types';
import { askUiQuestions, type UiAnswers } from './questions.js';
import { planUi } from './generate.js';

export const uiWizard: PluginWizard<UiAnswers> = {
  pluginId: 'ui',
  intro: 'UI Theming Kit — config-driven theme, scaling, typography.',
  run: askUiQuestions,
  plan: planUi,
};

export default uiWizard;
