/**
 * FILE: index.ts
 * PATH: packages/plugin-essentials/src/wizard/index.ts
 *
 * WHAT: The PluginWizard implementation for the Essentials plugin.
 * WHY:  This is the `./wizard` export the init flow dynamically imports and drives
 *       when the user selects Essentials during Step 4.
 * HOW:  Thin composition of askEssentialsQuestions() + planEssentials().
 * WHEN: Invoked once if Essentials is selected, during Step 5 of the init flow.
 *
 * EXPORTS: essentialsWizard (also as default — the init flow dynamically imports
 *          every plugin's `./wizard` entry and expects the default export uniformly)
 * DEPENDS ON: @armemon-library/config-types, ./questions, ./generate
 * USED BY: packages/cli-armemon/src/flows/initReactNative.ts
 */

import type { PluginWizard } from '@armemon-library/config-types';
import { askEssentialsQuestions, type EssentialsAnswers } from './questions.js';
import { planEssentials } from './generate.js';

export const essentialsWizard: PluginWizard<EssentialsAnswers> = {
  pluginId: 'essentials',
  intro: 'Essentials — notifications, network monitoring, loading & error overlays.',
  run: askEssentialsQuestions,
  plan: planEssentials,
};

export default essentialsWizard;
