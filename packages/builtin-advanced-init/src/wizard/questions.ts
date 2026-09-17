/**
 * FILE: questions.ts
 * PATH: packages/builtin-advanced-init/src/wizard/questions.ts
 *
 * WHAT: The always-on advanced-init question flow — env strategy, absolute import
 *       aliases, bundle identifier confirmation, and lint style.
 * WHY:  These are the "make the app actually pleasant to start real work in" details
 *       that every app needs regardless of which optional plugins were chosen, so
 *       they're asked unconditionally rather than gated behind plugin selection.
 * HOW:  Sequential @armemon-library/cli-kit prompts. The bundle-id default is READ from the
 *       generated native projects rather than reconstructed from the app name — the
 *       reconstructed value (org.reactjs.native.<appname>) matched neither the iOS
 *       default (org.reactjs.native.example.<AppName>) nor the Android one
 *       (com.<appname>), so the "differs from the default" check fired on correct
 *       answers and stayed silent on wrong ones.
 * WHEN: Called once, unconditionally, during Step 7 of the init flow.
 *
 * EXPORTS: askAdvancedInitQuestions, AdvancedInitAnswers
 * DEPENDS ON: @armemon-library/cli-kit, @armemon-library/config-types
 * USED BY: packages/builtin-advanced-init/src/wizard/index.ts
 */

import { promptConfirm, promptSelect, promptText, readNativeIdentifiers } from '@armemon-library/cli-kit';
import type { WizardContext } from '@armemon-library/config-types';

/** Reverse-DNS-ish; also what both Gradle and Xcode will accept. */
const BUNDLE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

export interface AdvancedInitAnswers {
  envStrategy: 'none' | 'react-native-dotenv';
  pathAliases: boolean;
  bundleId: string;
  lintStyle: 'default' | 'opinionated';
}

export async function askAdvancedInitQuestions(ctx: WizardContext): Promise<AdvancedInitAnswers> {
  const envStrategy = await promptSelect({
    message: 'Set up .env support?',
    options: [
      {
        value: 'react-native-dotenv',
        label: 'react-native-dotenv (recommended, simple Babel-based)',
      },
      { value: 'none', label: 'Skip for now' },
    ],
    initialValue: 'react-native-dotenv',
  });

  const pathAliases = await promptConfirm({
    message: 'Enable absolute imports (@/ -> src/)?',
    initialValue: true,
  });

  // Read from the projects the RN CLI actually generated, rather than
  // reconstructing a string that matched neither platform.
  const nativeIds = await readNativeIdentifiers(ctx.appRoot);
  const defaultBundleId =
    nativeIds.android ?? nativeIds.ios ?? `com.${ctx.appName.toLowerCase()}`;

  const bundleId = await promptText({
    message: 'iOS bundle identifier / Android package name',
    placeholder: defaultBundleId,
    defaultValue: defaultBundleId,
    validate: (value) =>
      BUNDLE_ID_PATTERN.test(value)
        ? undefined
        : 'Use reverse-DNS form with at least two segments, e.g. com.yourcompany.app.',
  });

  const lintStyle = await promptSelect({
    message: 'ESLint + Prettier setup style?',
    options: [
      { value: 'default', label: 'React Native CLI defaults' },
      { value: 'opinionated', label: 'armemon opinionated (stricter Prettier rules)' },
    ],
    initialValue: 'default',
  });

  return {
    envStrategy: envStrategy as AdvancedInitAnswers['envStrategy'],
    pathAliases,
    bundleId,
    lintStyle: lintStyle as AdvancedInitAnswers['lintStyle'],
  };
}
