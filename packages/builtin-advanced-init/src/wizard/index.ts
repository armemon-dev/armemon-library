/**
 * FILE: index.ts
 * PATH: packages/builtin-advanced-init/src/wizard/index.ts
 *
 * WHAT: The PluginWizard implementation for the always-on advanced-init step.
 * WHY:  This is the `./wizard` export the init flow dynamically imports and drives —
 *       satisfies the same PluginWizard contract every optional plugin implements, so
 *       the flow's "run a wizard" loop has exactly one code path for built-ins and
 *       plugins alike.
 * HOW:  Thin composition of askAdvancedInitQuestions() + planAdvancedInit().
 * WHEN: Invoked unconditionally during Step 7 of the init flow.
 *
 * EXPORTS: advancedInitWizard (also as default — the init flow dynamically imports
 *          every plugin's `./wizard` entry and expects the default export uniformly)
 * DEPENDS ON: @armemon-library/config-types, ./questions, ./generate
 * USED BY: packages/cli-armemon/src/flows/initReactNative.ts
 */

import type { PluginWizard } from '@armemon-library/config-types';
import { askAdvancedInitQuestions, type AdvancedInitAnswers } from './questions.js';
import { planAdvancedInit } from './generate.js';

export const advancedInitWizard: PluginWizard<AdvancedInitAnswers> = {
  pluginId: 'advanced-init',
  intro: 'Advanced setup — env, path aliases, bundle id, lint style.',
  run: askAdvancedInitQuestions,
  plan: planAdvancedInit,
};

export default advancedInitWizard;
