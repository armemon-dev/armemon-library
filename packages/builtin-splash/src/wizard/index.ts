/**
 * FILE: index.ts
 * PATH: packages/builtin-splash/src/wizard/index.ts
 *
 * WHAT: The PluginWizard implementation for the always-on splash screen step.
 * WHY:  This is the `./wizard` export the init flow dynamically imports and drives —
 *       satisfies the same PluginWizard contract every optional plugin implements.
 * HOW:  Thin composition of askSplashQuestions() + planSplash().
 * WHEN: Invoked unconditionally during Step 6 of the init flow.
 *
 * EXPORTS: splashWizard (also as default — the init flow dynamically imports every
 *          plugin's `./wizard` entry and expects the default export uniformly)
 * DEPENDS ON: @armemon-library/config-types, ./questions, ./generate
 * USED BY: packages/cli-armemon/src/flows/initReactNative.ts
 */

import type { PluginWizard } from '@armemon-library/config-types';
import { askSplashQuestions, type SplashAnswers } from './questions.js';
import { planSplash } from './generate.js';

export const splashWizard: PluginWizard<SplashAnswers> = {
  pluginId: 'splash',
  intro: 'Splash screen — native cold-start splash via react-native-bootsplash.',
  run: askSplashQuestions,
  plan: planSplash,
};

export default splashWizard;
