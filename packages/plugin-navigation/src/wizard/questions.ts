/**
 * FILE: questions.ts
 * PATH: packages/plugin-navigation/src/wizard/questions.ts
 *
 * WHAT: The React Navigation plugin's question flow — first asks whether to
 *       generate a real sample auth flow (Splash → Login/Register → Home) instead
 *       of the generic placeholder screens; if declined, asks navigator type,
 *       initial route, number of placeholder screens, deep linking, typed routes,
 *       and (when the app targets a specific RN version) a dependency-version
 *       strategy for react-native-screens/safe-area-context/react-navigation
 *       itself — these are exactly the packages that break the native build when a
 *       caret range drifts past what the target RN version's codegen parser
 *       supports.
 * WHY:  The sample-auth-flow question comes FIRST and, when accepted, skips
 *       navigatorType/initialRouteName/screenCount/enableDeepLinking entirely —
 *       those are meaningless once the shape is fixed to a pre-auth stack (a
 *       Splash→Login/Register→Home flow doesn't fit tabs/drawer, and there's
 *       nothing to configure about "how many screens" when it's always exactly
 *       these four). Forced true under --all-accept (isAutoAcceptEnabled()) rather
 *       than left to promptConfirm's own auto-accept fallback, since the
 *       question's own sensible interactive default (false — most users want their
 *       own screens, not opinionated samples) is deliberately the opposite of what
 *       --all-accept should produce (a fully-loaded, demonstrable app).
 * HOW:  Sequential @armemon-library/cli-kit prompts; the native dependency list passed to
 *       resolveDependencyVersions() is assembled from the SAME navigatorType
 *       conditionals generate.ts uses to decide which packages to install, so the
 *       two stay in lockstep. The sample-flow branch always resolves the 'stack'
 *       dependency set, since it literally is a stack navigator underneath.
 * WHEN: Called once if the user selects React Navigation during Step 4 of the init
 *       flow.
 *
 * EXPORTS: askNavigationQuestions, NavigationAnswers, NavigatorType
 * DEPENDS ON: @armemon-library/cli-kit, @armemon-library/config-types
 * USED BY: packages/plugin-navigation/src/wizard/index.ts
 */

import {
  promptConfirm,
  promptSelect,
  promptText,
  resolveDependencyVersions,
  validateScreenName,
  isAutoAcceptEnabled,
} from '@armemon-library/cli-kit';
import type { WizardContext } from '@armemon-library/config-types';

export type NavigatorType = 'stack' | 'tabs' | 'drawer' | 'stack-with-tabs';

export interface NavigationAnswers {
  navigatorType: NavigatorType;
  initialRouteName: string;
  screenCount: number;
  enableDeepLinking: boolean;
  typedRoutes: boolean;
  dependencyVersions: Record<string, string>;
  sampleAuthFlow: boolean;
}

const STACK_NATIVE_DEPS = [
  '@react-navigation/native',
  'react-native-screens',
  'react-native-safe-area-context',
  '@react-navigation/native-stack',
];

/**
 * Shared with `armemon create-screen`, so a route name means the same thing whether
 * it was typed at init or a year later — and so the rule has one home.
 */
const validateRouteName = validateScreenName;

async function resolveStackDependencyVersions(ctx: WizardContext): Promise<Record<string, string>> {
  return resolveDependencyVersions(
    ctx.rnVersion,
    STACK_NATIVE_DEPS.map((packageName) => ({ packageName })),
  );
}

export async function askNavigationQuestions(ctx: WizardContext): Promise<NavigationAnswers> {
  const sampleAuthFlow = isAutoAcceptEnabled()
    ? true
    : await promptConfirm({
        message: 'Generate a real sample screen flow (Splash → Login/Register → Home)?',
        initialValue: false,
      });

  if (sampleAuthFlow) {
    const dependencyVersions = await resolveStackDependencyVersions(ctx);

    return {
      navigatorType: 'stack',
      initialRouteName: 'Splash',
      screenCount: 0,
      // On, not off. Without a linking config React Navigation does no URL syncing at
      // all on web: every screen renders at the bare origin, and create-screen has
      // nothing to add a path to. A sample flow whose Login screen has no /Login is
      // not a demonstrable app.
      enableDeepLinking: true,
      typedRoutes: ctx.language !== 'javascript',
      dependencyVersions,
      sampleAuthFlow: true,
    };
  }

  const navigatorType = await promptSelect<NavigatorType>({
    message: 'Navigator type?',
    options: [
      { value: 'stack', label: 'Stack only' },
      { value: 'tabs', label: 'Bottom Tabs' },
      { value: 'drawer', label: 'Drawer' },
      { value: 'stack-with-tabs', label: 'Tabs nested inside a Stack' },
    ],
    initialValue: 'stack',
  });

  const initialRouteName = await promptText({
    message: 'Initial route name?',
    placeholder: 'Home',
    defaultValue: 'Home',
    validate: validateRouteName,
  });

  const screenCountInput = await promptText({
    message: 'How many placeholder screens to scaffold?',
    placeholder: '2',
    defaultValue: '2',
    validate: (value) => {
      const n = Number.parseInt(value, 10);
      return /^\d+$/.test(value.trim()) && n >= 1 && n <= 8
        ? undefined
        : 'Enter a whole number between 1 and 8.';
    },
  });

  // Default on. This is not a "stub": it is the file that gives every screen a real
  // URL on web, and the one create-screen adds each new screen's path to. Off means
  // every route in the browser sits at the bare origin, which reads as broken.
  const enableDeepLinking = await promptConfirm({
    message: 'Generate a deep-link config? (gives every screen its own URL on web)',
    initialValue: true,
  });

  // Typed routes are a TypeScript feature; in a JavaScript app the generated
  // param list would be stripped to nothing, so the question isn't worth asking.
  const typedRoutes =
    ctx.language === 'javascript'
      ? false
      : await promptConfirm({
          message: 'Use typed navigation (generate a RootStackParamList)?',
          initialValue: true,
        });

  const nativeDeps = ['@react-navigation/native', 'react-native-screens', 'react-native-safe-area-context'];
  if (navigatorType === 'stack' || navigatorType === 'stack-with-tabs') {
    nativeDeps.push('@react-navigation/native-stack');
  }
  if (navigatorType === 'tabs' || navigatorType === 'stack-with-tabs') {
    nativeDeps.push('@react-navigation/bottom-tabs');
  }
  if (navigatorType === 'drawer') {
    nativeDeps.push('@react-navigation/drawer', 'react-native-gesture-handler', 'react-native-reanimated');
  }

  const dependencyVersions = await resolveDependencyVersions(
    ctx.rnVersion,
    nativeDeps.map((packageName) => ({ packageName })),
  );

  return {
    navigatorType,
    initialRouteName,
    screenCount: Number.parseInt(screenCountInput, 10),
    enableDeepLinking,
    typedRoutes,
    dependencyVersions,
    sampleAuthFlow: false,
  };
}
