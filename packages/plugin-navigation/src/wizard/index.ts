/**
 * FILE: index.ts
 * PATH: packages/plugin-navigation/src/wizard/index.ts
 *
 * WHAT: The PluginWizard implementation for the React Navigation plugin.
 * WHY:  This is the `./wizard` export the init flow dynamically imports and drives
 *       when the user selects React Navigation during Step 4.
 * HOW:  Thin composition of askNavigationQuestions() + planNavigation().
 * WHEN: Invoked once if React Navigation is selected, during Step 5 of the init
 *       flow.
 *
 * EXPORTS: navigationWizard (also as default — the init flow dynamically imports
 *          every plugin's `./wizard` entry and expects the default export uniformly)
 * DEPENDS ON: @armemon-library/config-types, ./questions, ./generate
 * USED BY: packages/cli-armemon/src/flows/initReactNative.ts
 */

import type { PluginWizard } from '@armemon-library/config-types';
import { askNavigationQuestions, type NavigationAnswers } from './questions.js';
import { planNavigation } from './generate.js';

export const navigationWizard: PluginWizard<NavigationAnswers> = {
  pluginId: 'navigation',
  intro: 'React Navigation — stack, tabs, or drawer navigation with placeholder screens.',
  run: askNavigationQuestions,
  plan: planNavigation,
};

export default navigationWizard;
