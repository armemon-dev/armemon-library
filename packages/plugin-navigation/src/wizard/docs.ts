/**
 * FILE: docs.ts
 * PATH: packages/plugin-navigation/src/wizard/docs.ts
 *
 * WHAT: The comment blocks written into an app's generated navigation files.
 * WHY:  Navigation structure IS generated code — the app author reads and edits
 *       RootNavigator.tsx directly — so the options they will reach for on day one
 *       (a header title, a tab icon, a modal screen, a route param) belong in the
 *       file itself rather than behind a link to React Navigation's docs. There are
 *       two generators that emit these files (the plain wizard and the sample auth
 *       flow, which is what --all-accept produces), and the docs must not drift
 *       between them, so they live here rather than in either one.
 * HOW:  Plain string builders keyed by navigator type. No interpolation of user
 *       input beyond names the wizard itself chose.
 * WHEN: Called by generate.ts and generateSampleAuthFlow.ts while building plans.
 *
 * EXPORTS: rootNavigatorDoc, navigationGlueDoc, routeTypesDoc
 * DEPENDS ON: @armemon-library/config-types, ./questions
 */

import {
  SCREENS_DIR,
  layoutOf,
  managedFile,
  specifierFor,
  type WizardContext,
} from '@armemon-library/config-types';
import type { NavigationAnswers, NavigatorType } from './questions.js';

/**
 * The comment block that opens every generated RootNavigator.tsx.
 *
 * RootNavigator is ordinary React Navigation code the app owns outright — armemon
 * never reads it back. So rather than send people to the docs for the options they
 * will reach for on day one (a header title, a tab icon, a modal screen), the file
 * ships with them written out and commented, keyed to the navigator they picked.
 */
export function rootNavigatorDoc(
  navigatorType: NavigatorType,
  answers: NavigationAnswers,
  ctx: WizardContext,
): string {
  // The untyped branch used to hand a JavaScript app a TypeScript recipe: "create
  // ./types.ts and pass RootStackParamList to the factory" is not something a JS
  // project can act on, and typed routes are exactly why the question isn't asked
  // there in the first place.
  const typedNote = answers.typedRoutes
    ? ` *   Routes are TYPED: add the screen to RootStackParamList in ./types.ts too, and
 *   navigation.navigate('Name') autocompletes everywhere with no generics.`
    : ctx.language === 'javascript'
      ? ` *   Route names are plain strings — navigation.navigate('Name') works as soon as
 *   the screen is registered below. (Autocompleted, checked route names are a
 *   TypeScript feature; scaffold with --language ts if you want them.)`
      : ` *   Routes are UNTYPED (you chose not to generate types.ts). To turn typing on
 *   later, create ./types.ts with a RootStackParamList and pass it to the factory:
 *   createNativeStackNavigator<RootStackParamList>().`;

  // This navigator sits in the managed zone and screens sit in the author's, so the
  // hop between them depends on where the managed zone is — never spell it.
  const screensDir = specifierFor(
    managedFile.rootNavigator(layoutOf(ctx)),
    `${SCREENS_DIR}/NameScreen/index.tsx`,
  );

  const perType: Record<NavigatorType, string> = {
    stack: ` * STACK OPTIONS — pass to <Stack.Navigator screenOptions={...}> for all screens,
 * or to a single <Stack.Screen options={...}>:
 *
 *   screenOptions={{
 *     headerShown: true,              // false to hide the header everywhere
 *     headerTitleAlign: 'center',
 *     headerStyle: { backgroundColor: '#fff' },
 *     headerTintColor: '#111',        // back arrow + title colour
 *     animation: 'slide_from_right',  // 'fade' | 'none' | 'slide_from_bottom' | ...
 *     gestureEnabled: true,           // iOS swipe-back
 *     contentStyle: { backgroundColor: '#fff' },
 *   }}
 *
 *   A modal screen (presented over the current one):
 *   <Stack.Screen
 *     name="Settings"
 *     component={SettingsScreen}
 *     options={{ presentation: 'modal', title: 'Settings' }}
 *   />
 *
 *   A dynamic title from route params:
 *   <Stack.Screen
 *     name="Profile"
 *     component={ProfileScreen}
 *     options={({ route }) => ({ title: route.params.username })}
 *   />`,
    tabs: ` * TAB OPTIONS — pass to <Tab.Navigator screenOptions={...}> for all tabs, or to a
 * single <Tab.Screen options={...}>:
 *
 *   screenOptions={{
 *     headerShown: false,
 *     tabBarActiveTintColor: '#2563eb',
 *     tabBarInactiveTintColor: '#94a3b8',
 *     tabBarStyle: { height: 60, paddingBottom: 8 },
 *     tabBarLabelPosition: 'below-icon',
 *     tabBarHideOnKeyboard: true,
 *   }}
 *
 *   Per-tab label, icon and badge (icon takes any component — a vector icon, an
 *   <Image>, an emoji <Text>):
 *   <Tab.Screen
 *     name="Home"
 *     component={HomeScreen}
 *     options={{
 *       tabBarLabel: 'Home',
 *       tabBarBadge: 3,
 *       tabBarIcon: ({ color, size, focused }) => (
 *         <Text style={{ color, fontSize: size }}>{focused ? '*' : 'o'}</Text>
 *       ),
 *     }}
 *   />
 *
 *   Hide a tab from the bar but keep it navigable: options={{ tabBarButton: () => null }}`,
    drawer: ` * DRAWER OPTIONS — pass to <Drawer.Navigator screenOptions={...}> for every item,
 * or to a single <Drawer.Screen options={...}>:
 *
 *   screenOptions={{
 *     drawerType: 'front',            // 'front' | 'back' | 'slide' | 'permanent'
 *     drawerPosition: 'left',         // 'left' | 'right'
 *     drawerActiveTintColor: '#2563eb',
 *     drawerStyle: { width: 280 },
 *     headerShown: true,
 *     swipeEnabled: true,
 *   }}
 *
 *   Per-item label and icon:
 *   <Drawer.Screen
 *     name="Home"
 *     component={HomeScreen}
 *     options={{
 *       drawerLabel: 'Home',
 *       drawerIcon: ({ color, size }) => <Text style={{ color, fontSize: size }}>H</Text>,
 *     }}
 *   />
 *
 *   A fully custom drawer body:
 *   <Drawer.Navigator drawerContent={(props) => <MyDrawer {...props} />}>
 *
 *   Open or close it from anywhere: navigation.openDrawer() / closeDrawer() /
 *   toggleDrawer().`,
    'stack-with-tabs': ` * THIS IS A NESTED NAVIGATOR: a stack whose first route ("Tabs") renders the tab
 * navigator. Screens you add to Tabs appear in the tab bar; screens you add to the
 * Stack sit ABOVE the tabs (detail pages, modals) and hide the bar.
 *
 *   <Stack.Screen name="Details" component={DetailsScreen} />          // covers tabs
 *   <Stack.Screen
 *     name="Settings"
 *     component={SettingsScreen}
 *     options={{ presentation: 'modal', headerShown: true, title: 'Settings' }}
 *   />
 *
 *   Navigating into a nested screen from outside the tabs:
 *   navigation.navigate('Tabs', { screen: 'Home' });
 *
 *   Stack screenOptions: headerShown, animation, gestureEnabled, presentation,
 *   contentStyle. Tab screenOptions: tabBarActiveTintColor, tabBarStyle,
 *   tabBarIcon, tabBarBadge, tabBarHideOnKeyboard.`,
  };

  return `/**
 * RootNavigator — your app's navigation tree. This file is yours: armemon generated
 * it once and never reads it again, so rename screens, nest navigators, delete this
 * comment. Nothing in the CLI depends on its contents.
 *
 * ADDING A SCREEN
 *   1. Create the component at ${screensDir}/ — or run: armemon create-screen Name
 *   2. Import it below.
 *   3. Add one <${navigatorType === 'tabs' ? 'Tab' : navigatorType === 'drawer' ? 'Drawer' : 'Stack'}.Screen name="Name" component={NameScreen} /> line.
 *   Removing or renaming one is a command too: armemon remove-screen Name,
 *   armemon rename-screen Old New.
${typedNote}
 *
${perType[navigatorType]}
 *
 * NAVIGATING (works in any screen, no props needed)
 *   import { useNavigation } from '@react-navigation/native';
 *   const navigation = useNavigation();
 *   navigation.navigate('Screen2');            // go to a route (params: , { id: 7 })
 *   navigation.goBack();
 *   navigation.replace('Home');                // stack only: no back entry
 *   navigation.reset({ index: 0, routes: [{ name: 'Home' }] });  // wipe history
 *
 *   Reading params in the target screen:
 *   import { useRoute } from '@react-navigation/native';
 *   const { params } = useRoute();
 *
 *   Run something every time the screen is focused:
 *   import { useFocusEffect } from '@react-navigation/native';
 */
`;
}

/**
 * The comment block for the generated navigation glue file.
 *
 * Every <NavigationContainer> prop is reachable through configureNavigationPlugin,
 * and none of them are discoverable from a one-line call — so the call site lists
 * them.
 */
export function navigationGlueDoc(options: { appName: string; hasLinking: boolean }): string {
  const { appName, hasLinking } = options;

  // With deep linking off, no navigation.config file exists — so the example shows
  // the object inline rather than importing a file the app doesn't have.
  const linkingLine = hasLinking
    ? " *     linking,"
    : ` *     linking: {\n *       prefixes: ['${appName.toLowerCase()}://'],\n *       config: { screens: { Home: 'Home' } },\n *     },`;

  return `/**
 * Glue file: builds the plugin object armemon.config registers. The navigator tree
 * itself lives in ./RootNavigator — this file only configures the container around it.
 *
 * configureNavigationPlugin() accepts every <NavigationContainer> prop except
 * children. All optional:
 *
 *   linking      deep linking${hasLinking ? ', already wired from ./navigation.config' : ' (off — the example below turns it on)'}
 *   theme        colours for headers, tab bars and card backgrounds
 *   fallback     element shown while a deep link resolves (default: blank)
 *   documentTitle  web only: how the browser tab title follows the route
 *   initialState   restore a saved navigation state on launch
 *   onReady        fires once mounted — the place to hide a splash screen
 *   onStateChange  fires on every navigation — the place for screen analytics
 *   onUnhandledAction  fires when no navigator handled an action (dev aid)
 *
 * A fuller example — copy the lines you want into the call below:
 *
 *   import { DarkTheme, DefaultTheme } from '@react-navigation/native';
 *   import { Appearance } from 'react-native';
 *
 *   export const NavigationPlugin = configureNavigationPlugin({
${linkingLine}
 *     theme: Appearance.getColorScheme() === 'dark' ? DarkTheme : DefaultTheme,
 *     fallback: null,
 *     documentTitle: {
 *       formatter: (options, route) => options?.title ?? route?.name ?? '${appName}',
 *     },
 *     onReady: () => {
 *       // e.g. hideSplash() from ../splash
 *     },
 *     onStateChange: (state) => {
 *       // e.g. analytics.screen(state?.routes[state.index]?.name)
 *     },
 *     onUnhandledAction: (action) => {
 *       if (__DEV__) console.warn('Unhandled navigation action', action);
 *     },
 *   });
 */
`;
}

/**
 * The comment block for the generated route types file.
 *
 * The global-augmentation pattern is what makes navigate() autocomplete with no
 * per-call generics, and it is also the least obvious thing in the generated app:
 * nothing imports this file, so it looks dead until you know why it isn't.
 */
export function routeTypesDoc(): string {
  return `/**
 * Your route names and their params, in one place.
 *
 * Nothing imports this file on purpose. The 'declare global' block at the bottom
 * registers RootStackParamList with React Navigation itself, which is what makes
 * useNavigation() and navigate() autocomplete your routes everywhere — with no
 * generics at the call site.
 *
 * ADDING A ROUTE
 *   Add a line here, add the <Stack.Screen> in ./RootNavigator, done.
 *
 * ROUTE PARAMS
 *   undefined means the route takes none. To require params, describe them:
 *
 *     Profile: { userId: string };
 *     Article: { id: number; from?: 'feed' | 'search' };
 *
 *   navigate() then enforces them:
 *     navigation.navigate('Profile', { userId: 'abc' });
 *
 *   And the screen reads them typed:
 *     import type { NativeStackScreenProps } from '@react-navigation/native-stack';
 *     type Props = NativeStackScreenProps<RootStackParamList, 'Profile'>;
 *     export default function ProfileScreen({ route, navigation }: Props) {
 *       route.params.userId;
 *     }
 *
 * NESTED NAVIGATORS
 *   A route that renders another navigator carries that navigator's param list:
 *
 *     import type { NavigatorScreenParams } from '@react-navigation/native';
 *     export type TabParamList = { Feed: undefined; Settings: undefined };
 *     export type RootStackParamList = {
 *       Tabs: NavigatorScreenParams<TabParamList>;
 *     };
 *
 *   navigation.navigate('Tabs', { screen: 'Settings' });
 */
`;
}
