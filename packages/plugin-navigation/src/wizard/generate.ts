/**
 * FILE: generate.ts
 * PATH: packages/plugin-navigation/src/wizard/generate.ts
 *
 * WHAT: Turns NavigationAnswers into a PluginInstallPlan — placeholder screens, a
 *       RootNavigator.tsx matching the chosen navigator type, an optional deep
 *       linking config stub, an optional typed-routes declaration, and the per-app
 *       glue file wiring configureNavigationPlugin().
 * WHY:  Unlike Redux/UI's config-driven runtime, navigation structure IS the
 *       generated code — RootNavigator.tsx directly uses the real
 *       @react-navigation/* APIs rather than going through an abstraction layer,
 *       since navigator composition is exactly the kind of thing app authors expect
 *       to read and edit directly afterward.
 * HOW:  Screen names are [initialRouteName, Screen2, Screen3, ...] up to
 *       screenCount. Typed routes use React Navigation's documented global
 *       `declare global { namespace ReactNavigation { interface RootParamList } }`
 *       pattern — this types useNavigation()/navigate() everywhere with zero per-call
 *       generics, so RootNavigator.tsx's createXNavigator() calls stay identical
 *       whether typed routes are on or off.
 * WHEN: Called once by the wizard's plan() step, after askNavigationQuestions()
 *       resolves.
 *
 * EXPORTS: planNavigation
 * DEPENDS ON: @armemon-library/config-types, ./questions, ./generateSampleAuthFlow
 */

import type { PluginInstallPlan, WizardContext } from '@armemon-library/config-types';
import type { NavigationAnswers, NavigatorType } from './questions.js';
import { planSampleAuthFlow } from './generateSampleAuthFlow.js';
import { buildScreenFiles, normalizeScreenName } from '@armemon-library/cli-kit';
import { SCREENS_DIR, layoutOf, managedFile, specifierFor } from '@armemon-library/config-types';
import { navigationGlueDoc, rootNavigatorDoc, routeTypesDoc } from './docs.js';

/**
 * The initial route plus generated placeholders, de-duplicated.
 *
 * Without the de-duplication, an initialRouteName of "Screen2" with screenCount 2
 * produced ['Screen2', 'Screen2'] — a duplicate route registration, two writes to
 * the same file, and two identical imports in RootNavigator.tsx, i.e. a guaranteed
 * compile error from an answer the prompt happily accepted.
 */
function screenNames(answers: NavigationAnswers): string[] {
  const names = [answers.initialRouteName];
  let candidate = 2;
  while (names.length < Math.max(1, answers.screenCount)) {
    const name = `Screen${candidate}`;
    if (!names.includes(name)) names.push(name);
    candidate += 1;
  }
  return names;
}

/**
 * A placeholder screen, in the same folder shape every screen in the app uses.
 *
 * Built by cli-kit rather than here so that `armemon create-screen` and this wizard
 * cannot drift: one definition of where a screen lives and what it looks like.
 */
function screenFiles(name: string, ctx: WizardContext): PluginInstallPlan['filesToWrite'] {
  return buildScreenFiles({
    routeName: name,
    shape: 'flat',
    language: ctx.language,
    kind: 'placeholder',
    layout: layoutOf(ctx),
  });
}

function screenImports(names: string[], rootNavigatorPath: string): string {
  // The navigator is in the managed zone and the screens are in the author's, so this
  // specifier is the seam between them — computed, never spelled.
  return names
    .map((name) => `import ${name}Screen from '${specifierFor(rootNavigatorPath, `${SCREENS_DIR}/${name}Screen/index.tsx`)}';`)
    .join('\n');
}

function buildRootNavigator(
  navigatorType: NavigatorType,
  answers: NavigationAnswers,
  ctx: WizardContext,
): string {
  const names = screenNames(answers);
  const imports = screenImports(names, managedFile.rootNavigator(layoutOf(ctx)));

  // With typed routes on, each navigator factory needs its param list generic.
  // Without it screens are typed against ParamListBase and any screen component
  // annotated with <RootStackParamList, 'X'> fails to assign to it.
  const stackGeneric = answers.typedRoutes ? '<RootStackParamList>' : '';
  const tabGeneric = answers.typedRoutes
    ? navigatorType === 'stack-with-tabs'
      ? '<TabParamList>'
      : '<RootStackParamList>'
    : '';
  const typesImport = answers.typedRoutes
    ? `import type { ${navigatorType === 'stack-with-tabs' ? 'RootStackParamList, TabParamList' : 'RootStackParamList'} } from './types';\n`
    : '';

  const doc = rootNavigatorDoc(navigatorType, answers, ctx);

  if (navigatorType === 'tabs') {
    const tabScreens = names.map((name) => `      <Tab.Screen name="${name}" component={${name}Screen} />`).join('\n');
    return `${doc}import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
${typesImport}${imports}

const Tab = createBottomTabNavigator${tabGeneric}();

export default function RootNavigator() {
  return (
    <Tab.Navigator initialRouteName="${answers.initialRouteName}">
${tabScreens}
    </Tab.Navigator>
  );
}
`;
  }

  if (navigatorType === 'drawer') {
    const drawerScreens = names.map((name) => `      <Drawer.Screen name="${name}" component={${name}Screen} />`).join('\n');
    return `${doc}import React from 'react';
import { createDrawerNavigator } from '@react-navigation/drawer';
${typesImport}${imports}

const Drawer = createDrawerNavigator${stackGeneric}();

export default function RootNavigator() {
  return (
    <Drawer.Navigator initialRouteName="${answers.initialRouteName}">
${drawerScreens}
    </Drawer.Navigator>
  );
}
`;
  }

  if (navigatorType === 'stack-with-tabs') {
    const tabScreens = names.map((name) => `      <Tab.Screen name="${name}" component={${name}Screen} />`).join('\n');
    return `${doc}import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
${typesImport}${imports}

const Stack = createNativeStackNavigator${stackGeneric}();
const Tab = createBottomTabNavigator${tabGeneric}();

function Tabs() {
  return (
    <Tab.Navigator initialRouteName="${answers.initialRouteName}">
${tabScreens}
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Tabs" component={Tabs} />
    </Stack.Navigator>
  );
}
`;
  }

  const stackScreens = names.map((name) => `      <Stack.Screen name="${name}" component={${name}Screen} />`).join('\n');
  return `${doc}import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
${typesImport}${imports}

const Stack = createNativeStackNavigator${stackGeneric}();

export default function RootNavigator() {
  return (
    <Stack.Navigator initialRouteName="${answers.initialRouteName}">
${stackScreens}
    </Stack.Navigator>
  );
}
`;
}

export async function planNavigation(
  rawAnswers: NavigationAnswers,
  ctx: WizardContext,
): Promise<PluginInstallPlan> {
  // Typed routes are a TypeScript feature. The interactive wizard already declines
  // to ask in a JavaScript app, but plan() is also called with answers replayed
  // from armemon.config and by third-party tooling — and a true here produced a
  // types.ts that the language conversion then dropped as type-only, leaving a
  // navigator whose generics were stripped and a doc comment pointing at a file
  // the app never had.
  const answers: NavigationAnswers = {
    ...rawAnswers,
    typedRoutes: rawAnswers.typedRoutes && ctx.language !== 'javascript',
  };

  if (answers.sampleAuthFlow) {
    return planSampleAuthFlow(answers, ctx);
  }

  const layout = layoutOf(ctx);
  const names = screenNames(answers);
  const filesToWrite: PluginInstallPlan['filesToWrite'] = names.flatMap((name) =>
    screenFiles(name, ctx),
  );

  filesToWrite.push({
    path: managedFile.rootNavigator(layout),
    content: buildRootNavigator(answers.navigatorType, answers, ctx),
  });

  // Versions come from questions.ts's dependency-version question (recommended
  // pins sourced from testingApp / researched RN-0.76-compatible majors, "latest"
  // for every package if the app targets --rn-version latest, or user-entered
  // custom versions) — the exact same navigatorType conditionals decide which
  // packages appear here as decide which ones get asked about there.
  const npmDependencies: Record<string, string> = { ...answers.dependencyVersions };

  const postInstallNotes: string[] = [];
  const babelPlugins: string[] = [];
  const entryPrelude: string[] = [];

  if (answers.navigatorType === 'drawer') {
    // Both of these used to be a postInstallNote, which meant choosing Drawer
    // produced an app that crashed on launch until the user read the note and
    // hand-edited two files. Reanimated throws at startup without its Babel plugin,
    // and gesture-handler's import genuinely has to be the first line of the entry
    // file — both are things armemon already owns and can simply do.
    entryPrelude.push("import 'react-native-gesture-handler';");
    babelPlugins.push("'react-native-reanimated/plugin'");
  }

  let linkingImport = '';
  if (answers.enableDeepLinking) {
    // The same rule `armemon create-screen` uses, so a route's URL doesn't depend on
    // which command created the screen.
    const linkPath = (name: string): string => normalizeScreenName(name).linkingPath;
    // In stack-with-tabs these screens belong to the tab navigator the stack's "Tabs"
    // route renders, and the config has to mirror that: React Navigation resolves a
    // flat entry to a root route the stack doesn't have, so the link opened nothing.
    const linkingScreens = answers.navigatorType === 'stack-with-tabs'
      ? `      Tabs: {\n        screens: {\n${names.map((name) => `          ${name}: '${linkPath(name)}',`).join('\n')}\n        },\n      },`
      : names.map((name) => `      ${name}: '${linkPath(name)}',`).join('\n');
    // A route this app really has — the doc used to name "screen2" even when there wasn't one.
    const exampleLink = linkPath(names[1] ?? names[0]!);
    filesToWrite.push({
      path: managedFile.linking(layout),
      content: `/**
 * Deep linking — how a URL maps onto a route in RootNavigator.
 *
 * This object is handed straight to <NavigationContainer linking={...}>, so every
 * option React Navigation documents for it works here. The commented blocks below
 * are the ones you are most likely to want; uncomment and edit in place.
 *
 * TEST A LINK WITHOUT LEAVING THE TERMINAL
 *   iOS      npx uri-scheme open "${ctx.appName.toLowerCase()}://${exampleLink}" --ios
 *   Android  npx uri-scheme open "${ctx.appName.toLowerCase()}://${exampleLink}" --android
 *   Web      just visit /${exampleLink}
 *
 * Paths match case-sensitively: /${exampleLink} and /${exampleLink.toLowerCase()} are different links.
 */
export const linking = {
  /**
   * Every URL shape that belongs to this app. Add your https origins here for
   * iOS Universal Links / Android App Links:
   *
   *   prefixes: [
   *     '${ctx.appName.toLowerCase()}://',
   *     'https://${ctx.appName.toLowerCase()}.com',
   *     'https://www.${ctx.appName.toLowerCase()}.com',
   *   ],
   */
  prefixes: ['${ctx.appName.toLowerCase()}://'],

  config: {
    /**
     * Route name -> path. One entry per screen; the path is matched against the
     * part of the URL after the prefix.
     */
    screens: {
${linkingScreens}

      /**
       * PATH PARAMETERS — ':name' becomes route.params.name:
       *   Profile: 'user/:id',                    // ${ctx.appName.toLowerCase()}://user/42
       *
       * FULL FORM — when you need more than a path string:
       *   Profile: {
       *     path: 'user/:id',
       *     // Turn the string from the URL into the type your screen expects:
       *     parse: { id: (id) => Number(id) },
       *     // ...and back again when React Navigation builds a URL for this route:
       *     stringify: { id: (id) => String(id) },
       *     exact: true,        // ignore any path inherited from a parent navigator
       *   },
       *
       * NESTED NAVIGATORS — mirror the nesting:
       *   Tabs: {
       *     path: 'app',
       *     screens: { Home: 'Home', Settings: 'Settings' },
       *   },
       *
       * CATCH-ALL — '*' matches anything unmatched; pair it with a NotFound screen:
       *   NotFound: '*',
       */
    },

    /**
     * Which route sits underneath a deep-linked screen, so Back has somewhere to go:
     *   initialRouteName: '${answers.initialRouteName}',
     */
  },

  /**
   * ADVANCED — all optional, all documented by React Navigation:
   *
   *   enabled: false,                     // turn linking off (e.g. per-environment)
   *   getInitialURL: async () => {        // e.g. read a URL out of a push payload
   *     return (await Linking.getInitialURL()) ?? null;
   *   },
   *   subscribe: (listener) => {          // custom source of incoming links
   *     const sub = Linking.addEventListener('url', ({ url }) => listener(url));
   *     return () => sub.remove();
   *   },
   *   getStateFromPath: (path, options) => { ... },   // full manual control
   *   getPathFromState: (state, options) => { ... },
   */
};
`,
    });
    linkingImport = "import { linking } from './navigation.config';\n";
    // The JS half is generated; the native half can't be, and saying nothing made
    // this look finished when the link would never actually fire.
    postInstallNotes.push(
      `Deep linking is wired on the JS side with the "${ctx.appName.toLowerCase()}://" scheme, but the native half isn't: register the scheme in ios/${ctx.appName}/Info.plist (CFBundleURLTypes) and in android/app/src/main/AndroidManifest.xml (an intent-filter with <data android:scheme="${ctx.appName.toLowerCase()}" />) before links will open the app.`,
    );
  }

  if (answers.typedRoutes) {
    const paramListEntries = names.map((name) => `  ${name}: undefined;`).join('\n');

    // For stack-with-tabs the ROOT navigator has exactly one route ("Tabs") and the
    // screen names belong to the nested tab navigator. Emitting the screen names as
    // the root param list — as this used to — made navigate('Tabs') a type error and
    // navigate('Home') type-check against a route the stack doesn't have.
    const doc = routeTypesDoc();
    const content =
      answers.navigatorType === 'stack-with-tabs'
        ? `${doc}import type { NavigatorScreenParams } from '@react-navigation/native';

export type TabParamList = {
${paramListEntries}
};

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList>;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
`
        : `${doc}export type RootStackParamList = {
${paramListEntries}
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
`;

    filesToWrite.push({ path: managedFile.routeTypes(layout), content });
  }

  filesToWrite.push({
    path: managedFile.navigationGlue(layout),
    content: `import { configureNavigationPlugin } from '@armemon-library/navigation';
${linkingImport}
${navigationGlueDoc({ appName: ctx.appName, hasLinking: answers.enableDeepLinking })}export const NavigationPlugin = configureNavigationPlugin(${
      answers.enableDeepLinking ? '{ linking }' : ''
    });
`,
  });

  return {
    npmDependencies,
    filesToWrite,
    babelPlugins: babelPlugins.length > 0 ? babelPlugins : undefined,
    entryPrelude: entryPrelude.length > 0 ? entryPrelude : undefined,
    appEntryContributions: {
      providerImport: { importName: 'NavigationPlugin', from: './navigation/index' },
      registerInRuntimeConfig: true,
    },
    // RootNavigator is what the App entry renders.
    provides: ['app-root'],
    postInstallNotes: postInstallNotes.length > 0 ? postInstallNotes : undefined,
  };
}
