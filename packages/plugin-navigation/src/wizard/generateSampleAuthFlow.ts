/**
 * FILE: generateSampleAuthFlow.ts
 * PATH: packages/plugin-navigation/src/wizard/generateSampleAuthFlow.ts
 *
 * WHAT: Generates a real, working Splash → Login/Register → Home screen flow,
 *       instead of the generic placeholder screens generate.ts normally produces.
 * WHY:  Kept as its own file rather than threading conditionals through the generic
 *       screen-builder — these screens are qualitatively different (real forms,
 *       navigation-driven auth state, not `<Text>{name}</Text>` placeholders) and
 *       deserve their own generation code. Whether the screens dispatch to the
 *       generated Redux `auth` slice or fall back to local `useState` is decided
 *       once here (at generation time, not runtime) by checking
 *       ctx.alreadyAnsweredByOtherPlugins.redux — this only works because
 *       plugin-redux's wizard is guaranteed to run first, which this package now
 *       declares as `armemon.dependsOn: ["redux"]` and the CLI enforces by
 *       topologically sorting wizards. It previously relied on the order of a
 *       hand-written array in cli-armemon's constants.ts, guarded only by a comment.
 * HOW:  Each screen has two full string templates (Redux-wired, local-state
 *       fallback) rather than one generic template with injected fragments — the
 *       control flow differs enough (different imports, different hooks, different
 *       dispatch calls) that trying to genericize would be harder to read than the
 *       duplication. Register never invokes a real register thunk (the generated
 *       auth slice only exports loginThunk/logout, no register action) — it does
 *       local validation then hands off to Login either way, with a comment
 *       pointing at where to wire a real register call once one exists.
 * WHEN: Called once by planNavigation() when answers.sampleAuthFlow is true,
 *       replacing the generic placeholder-screen generation entirely.
 *
 * EXPORTS: planSampleAuthFlow
 * DEPENDS ON: @armemon-library/config-types, ./questions
 */

import {
  SCREENS_DIR,
  SLICES_DIR,
  layoutOf,
  managedFile,
  managedPath,
  specifierFor,
  type PluginInstallPlan,
  type WizardContext,
} from '@armemon-library/config-types';
import type { NavigationAnswers } from './questions.js';
import { navigationGlueDoc, routeTypesDoc } from './docs.js';

/**
 * Every path the generated files name, computed from the app's layout rather than
 * spelled out.
 *
 * These four screens live in the author's zone and the navigator, route types and
 * store live in the managed one, so every import here crosses between them — and a
 * hardcoded `../../armemon/navigation/types` silently became wrong the moment the
 * managed zone moved to the app root. All four screens sit at the same depth, so one
 * set of specifiers serves all of them.
 */
interface FlowPaths {
  /** From a screen's index to the managed route types. */
  routeTypes: string;
  /** From a screen's index to the auth slice. */
  authSlice: string;
  /** From a screen's index to the root navigator. */
  rootNavigator: string;
  /** From the root navigator to one screen's folder. */
  screen: (routeName: string) => string;
  /** App-relative, for prose that names a file rather than importing it. */
  runtimeConfig: string;
  reduxGlue: string;
  reduxDir: string;
}

function flowPaths(ctx: WizardContext): FlowPaths {
  const layout = layoutOf(ctx);
  // Any screen will do: they are all src/screens/<Name>Screen/index.tsx.
  const aScreen = `${SCREENS_DIR}/AnyScreen/index.tsx`;
  const rootNavigator = managedFile.rootNavigator(layout);
  return {
    routeTypes: specifierFor(aScreen, managedFile.routeTypes(layout)),
    authSlice: specifierFor(aScreen, `${SLICES_DIR}/authSlice.ts`),
    rootNavigator: specifierFor(aScreen, rootNavigator),
    screen: (routeName) =>
      specifierFor(rootNavigator, `${SCREENS_DIR}/${routeName}Screen/index.tsx`),
    runtimeConfig: managedPath(layout, 'runtime.config'),
    reduxGlue: managedFile.reduxGlue(layout),
    reduxDir: managedPath(layout, 'redux'),
  };
}

interface ReduxAuthInfo {
  enabled: boolean;
  /**
   * The Redux wizard lets the user rename the auth slice's token field. The splash
   * screen reads it to decide whether the user is already signed in, so hardcoding
   * `token` here meant renaming it to e.g. `accessToken` produced an app that always
   * bounced you back to Login however successfully you logged in.
   */
  tokenName: string;
}

function detectReduxAuth(ctx: WizardContext): ReduxAuthInfo {
  const reduxAnswers = ctx.alreadyAnsweredByOtherPlugins.redux as
    | { sliceTemplates?: string[]; tokenName?: string }
    | undefined;

  const enabled = reduxAnswers?.sliceTemplates?.includes('auth') ?? false;
  return { enabled, tokenName: reduxAnswers?.tokenName || 'token' };
}

const SHARED_STYLES = `const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 12 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 },
  button: { backgroundColor: '#2563eb', borderRadius: 8, padding: 14, alignItems: 'center' },
  logoutButton: { backgroundColor: '#dc2626', borderRadius: 8, paddingVertical: 12, paddingHorizontal: 24 },
  buttonText: { color: '#fff', fontWeight: '600' },
  link: { textAlign: 'center', color: '#2563eb', marginTop: 8 },
  error: { color: '#dc2626' },
});
`;

function splashScreenDoc(paths: FlowPaths): string {
  return `/**
 * The first screen shown once armemon's init tasks finish.
 *
 * Its only job is deciding where to go, then replace()-ing there — replace rather
 * than navigate, so there is no back entry returning the user to a loading screen.
 *
 * A real session check usually looks like this:
 *
 *   useEffect(() => {
 *     let cancelled = false;
 *     (async () => {
 *       const token = await storage.getItem('token');
 *       if (cancelled) return;
 *       navigation.replace(token ? 'Home' : 'Login');
 *     })();
 *     return () => { cancelled = true; };
 *   }, [navigation]);
 *
 * The cancelled flag matters: navigating after the screen unmounts warns in
 * development and does nothing useful in production.
 *
 * If the check is quick, consider doing it as an armemon init task instead (see
 * ${paths.runtimeConfig}) — the splash is already up while those run, so the
 * app can open directly on the right screen with no extra frame.
 */
`;
}

function splashScreen(auth: ReduxAuthInfo, paths: FlowPaths): string {
  if (auth.enabled) {
    return `${splashScreenDoc(paths)}import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSelector } from '@armemon-library/redux';
import type { RootStackParamList } from '${paths.routeTypes}';

type Props = NativeStackScreenProps<RootStackParamList, 'Splash'>;

export default function SplashScreen({ navigation }: Props) {
  // Real apps would type this against a generated RootState — kept as \`any\` here
  // since armemon doesn't generate a typed RootState/AppDispatch pair yet.
  const token = useSelector((state: any) => state.auth?.${auth.tokenName});

  useEffect(() => {
    navigation.replace(token ? 'Home' : 'Login');
  }, [token, navigation]);

  return (
    <View style={styles.centered}>
      <ActivityIndicator size="large" />
    </View>
  );
}

${SHARED_STYLES}`;
  }

  return `${splashScreenDoc(paths)}import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '${paths.routeTypes}';

type Props = NativeStackScreenProps<RootStackParamList, 'Splash'>;

export default function SplashScreen({ navigation }: Props) {
  useEffect(() => {
    navigation.replace('Login');
  }, [navigation]);

  return (
    <View style={styles.centered}>
      <ActivityIndicator size="large" />
    </View>
  );
}

${SHARED_STYLES}`;
}

function loginScreenDocRedux(paths: FlowPaths): string {
  return `/**
 * Sign-in screen, wired to the generated Redux auth slice.
 *
 * HOW IT WORKS
 *   handleLogin dispatches loginThunk; the slice moves status through
 *   'loading' -> 'succeeded' | 'failed'; the effect below navigates on success.
 *   Driving navigation off state rather than off the dispatch call means a session
 *   restored anywhere else lands on the same screen transition.
 *
 * WIRING YOUR REAL BACKEND
 *   Edit loginThunk in ${paths.authSlice} — this screen needs no change.
 *
 * SHOWING THE ERROR
 *   The slice already stores one:
 *     const error = useSelector((state: any) => state.auth?.error);
 *     {error ? <Text style={styles.error}>{error}</Text> : null}
 *
 * ABOUT THE 'as any' ON DISPATCH
 *   Plain Dispatch doesn't know about thunks. Type it once and the cast goes away:
 *     // in ${paths.reduxGlue}
 *     export type AppDispatch = typeof ReduxPlugin.store.dispatch;
 *     // here
 *     const dispatch = useDispatch<AppDispatch>();
 */
`;
}

const LOGIN_SCREEN_DOC_LOCAL = `/**
 * Sign-in screen, using local component state.
 *
 * There is no backend and no auth store: handleLogin waits 600ms and navigates, so
 * you can click through the flow immediately. Two ways to make it real:
 *
 *   1. Call your API here:
 *        const res = await fetch('https://api.example.com/login', {
 *          method: 'POST',
 *          headers: { 'Content-Type': 'application/json' },
 *          body: JSON.stringify({ email, password }),
 *        });
 *        if (!res.ok) { setError('Wrong email or password.'); return; }
 *        navigation.replace('Home');
 *
 *   2. Or re-run 'armemon init' with the Redux plugin and its "auth" slice, and
 *      this screen is generated already wired to a loginThunk.
 *
 * replace() rather than navigate(): after signing in, back should not return to
 * the login form.
 */
`;

function loginScreen(auth: ReduxAuthInfo, paths: FlowPaths): string {
  if (auth.enabled) {
    return `${loginScreenDocRedux(paths)}import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useDispatch, useSelector } from '@armemon-library/redux';
import { loginThunk } from '${paths.authSlice}';
import type { RootStackParamList } from '${paths.routeTypes}';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

export default function LoginScreen({ navigation }: Props) {
  const dispatch = useDispatch();
  const status = useSelector((state: any) => state.auth?.status);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (status === 'succeeded') navigation.replace('Home');
  }, [status, navigation]);

  const handleLogin = () => {
    // dispatch()'s plain Dispatch type doesn't know about thunks without a typed
    // AppDispatch — armemon doesn't generate one yet, hence the cast.
    dispatch(loginThunk({ email, password }) as any);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Log in</Text>
      <TextInput
        style={styles.input}
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      <Pressable style={styles.button} onPress={handleLogin} disabled={status === 'loading'}>
        <Text style={styles.buttonText}>{status === 'loading' ? 'Logging in…' : 'Log in'}</Text>
      </Pressable>
      <Pressable onPress={() => navigation.navigate('Register')}>
        <Text style={styles.link}>Don&apos;t have an account? Register</Text>
      </Pressable>
    </View>
  );
}

${SHARED_STYLES}`;
  }

  return `${LOGIN_SCREEN_DOC_LOCAL}import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '${paths.routeTypes}';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

export default function LoginScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = () => {
    setLoading(true);
    // No backend wired up yet — replace with your real API call.
    setTimeout(() => {
      setLoading(false);
      navigation.replace('Home');
    }, 600);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Log in</Text>
      <TextInput
        style={styles.input}
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      <Pressable style={styles.button} onPress={handleLogin} disabled={loading}>
        <Text style={styles.buttonText}>{loading ? 'Logging in…' : 'Log in'}</Text>
      </Pressable>
      <Pressable onPress={() => navigation.navigate('Register')}>
        <Text style={styles.link}>Don&apos;t have an account? Register</Text>
      </Pressable>
    </View>
  );
}

${SHARED_STYLES}`;
}

const REGISTER_SCREEN_DOC = `/**
 * Account creation screen.
 *
 * Client-side it already does the one check every register form needs — the two
 * password fields must match — and shows the message in styles.error.
 *
 * MAKING IT REAL
 *   Replace the setTimeout with your API call, and treat the failure case as
 *   first-class: a register endpoint says "that email is taken" far more often
 *   than a login endpoint says anything interesting.
 *
 *     try {
 *       const res = await fetch('https://api.example.com/register', {
 *         method: 'POST',
 *         headers: { 'Content-Type': 'application/json' },
 *         body: JSON.stringify({ email, password }),
 *       });
 *       if (!res.ok) { setError((await res.json()).message ?? 'Could not register.'); return; }
 *       navigation.replace('Login');
 *     } finally {
 *       setLoading(false);
 *     }
 *
 * VALIDATION WORTH ADDING
 *   A minimum password length, and a trimmed non-empty email. Both are cheap here
 *   and save a round trip.
 *
 * After registering this goes to Login rather than straight to Home, so the user
 * signs in through the real path once. Change the replace() target if you would
 * rather sign them in immediately.
 */
`;

function registerScreen(auth: ReduxAuthInfo, paths: FlowPaths): string {
  const backendNote = auth.enabled
    ? [
        '// The generated auth slice only has loginThunk/logout, no register action —',
        '    // wire a real register thunk here once your backend has one, then dispatch',
        '    // it the same way LoginScreen dispatches loginThunk.',
      ].join('\n')
    : '// No backend wired up yet — replace with your real API call.';

  return `${REGISTER_SCREEN_DOC}import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '${paths.routeTypes}';

type Props = NativeStackScreenProps<RootStackParamList, 'Register'>;

export default function RegisterScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleRegister = () => {
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setError(null);
    setLoading(true);
    ${backendNote}
    setTimeout(() => {
      setLoading(false);
      navigation.replace('Login');
    }, 600);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Register</Text>
      <TextInput
        style={styles.input}
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      <TextInput
        style={styles.input}
        placeholder="Confirm password"
        secureTextEntry
        value={confirmPassword}
        onChangeText={setConfirmPassword}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable style={styles.button} onPress={handleRegister} disabled={loading}>
        <Text style={styles.buttonText}>{loading ? 'Creating account…' : 'Register'}</Text>
      </Pressable>
      <Pressable onPress={() => navigation.navigate('Login')}>
        <Text style={styles.link}>Already have an account? Log in</Text>
      </Pressable>
    </View>
  );
}

${SHARED_STYLES}`;
}

function homeScreenDoc(language: WizardContext['language'], paths: FlowPaths): string {
  return `/**
 * The signed-in screen — replace this with your actual app.
 *
 * LOGGING OUT
 *   replace('Login') swaps this screen so back can't return to it. If you have
 *   several screens stacked by now, clear the whole history instead:
 *
 *     navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
 *
 *   And clear the session itself in the same handler — the token in storage, and
 *   any persisted Redux state:
 *
 *     await storage.removeItem('token');
 *     ReduxPlugin.persistor.purge();   // from ${paths.reduxDir}
 *
 * GROWING PAST ONE SCREEN
 *   Add screens to ${paths.rootNavigator}${
    language === 'javascript' ? '' : ` (and to RootStackParamList in ${paths.routeTypes})`
  }, or nest a tab
 *   navigator here so Home becomes the tabbed part of the app while Login and
 *   Register stay outside it.
 */
`;
}

function homeScreen(
  auth: ReduxAuthInfo,
  language: WizardContext['language'],
  paths: FlowPaths,
): string {
  if (auth.enabled) {
    return `${homeScreenDoc(language, paths)}import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useDispatch } from '@armemon-library/redux';
import { logout } from '${paths.authSlice}';
import type { RootStackParamList } from '${paths.routeTypes}';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

export default function HomeScreen({ navigation }: Props) {
  const dispatch = useDispatch();

  const handleLogout = () => {
    dispatch(logout());
    navigation.replace('Login');
  };

  return (
    <View style={styles.centered}>
      <Text style={styles.title}>Welcome</Text>
      <Pressable style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.buttonText}>Log out</Text>
      </Pressable>
    </View>
  );
}

${SHARED_STYLES}`;
  }

  return `${homeScreenDoc(language, paths)}import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '${paths.routeTypes}';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

export default function HomeScreen({ navigation }: Props) {
  const handleLogout = () => {
    navigation.replace('Login');
  };

  return (
    <View style={styles.centered}>
      <Text style={styles.title}>Welcome</Text>
      <Pressable style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.buttonText}>Log out</Text>
      </Pressable>
    </View>
  );
}

${SHARED_STYLES}`;
}

export async function planSampleAuthFlow(
  answers: NavigationAnswers,
  ctx: WizardContext,
): Promise<PluginInstallPlan> {
  const auth = detectReduxAuth(ctx);
  const layout = layoutOf(ctx);
  const paths = flowPaths(ctx);

  // Honoured here exactly as in the plain wizard. Without it NavigationContainer gets
  // no `linking` at all, and React Navigation then does no URL syncing on web: every
  // one of these four screens renders at the bare origin.
  const deepLinking = answers.enableDeepLinking;
  const scheme = ctx.appName.toLowerCase();

  // A JavaScript app has no types file — the generated one is types only, so the
  // language conversion drops it. Telling the reader to edit it would send them
  // looking for something that was never written.
  const typedStep =
    ctx.language === 'javascript'
      ? ` *   3. That is all — route names are plain strings here.`
      : ` *   3. Add 'Name' to RootStackParamList in ./types — that is what makes
 *      navigation.navigate('Name') autocomplete and type-check.`;

  const filesToWrite: PluginInstallPlan['filesToWrite'] = [
    { path: `${SCREENS_DIR}/SplashScreen/index.tsx`, content: splashScreen(auth, paths) },
    { path: `${SCREENS_DIR}/LoginScreen/index.tsx`, content: loginScreen(auth, paths) },
    { path: `${SCREENS_DIR}/RegisterScreen/index.tsx`, content: registerScreen(auth, paths) },
    { path: `${SCREENS_DIR}/HomeScreen/index.tsx`, content: homeScreen(auth, ctx.language, paths) },
    {
      path: managedFile.rootNavigator(layout),
      content: `/**
 * RootNavigator — the sample auth flow's navigation tree.
 *
 * This file is yours: armemon generated it once and never reads it again. The four
 * screens are a working example of the shape almost every app starts with — a
 * splash that decides where to go, an unauthenticated pair, and the app itself.
 *
 * THE FLOW
 *   Splash    checks whether the user is signed in, then replace()s to Login or Home
 *   Login     signs in, then replace()s to Home
 *   Register  creates an account, then replace()s to Home
 *   Home      the signed-in app; Log out replace()s back to Login
 *
 *   replace() rather than navigate(): it leaves no back entry, so the hardware back
 *   button can't return to the splash or back into a session the user just left.
 *
 * ADDING A SCREEN
 *   1. Create it at ${paths.screen('Name')}/ — or run: armemon create-screen Name
 *   2. Import it below and add one <Stack.Screen name="Name" component={NameScreen} />.
 *   Removing or renaming one is a command too: armemon remove-screen Name,
 *   armemon rename-screen Old New.
${typedStep}
 *
 * SCREEN OPTIONS — on <Stack.Navigator screenOptions={...}> for every screen, or on
 * one <Stack.Screen options={...}> as Home does below:
 *
 *   headerShown: true,              // this navigator hides it by default
 *   title: 'Sign in',               // header text for that screen
 *   headerBackVisible: false,       // no back control (a login screen wants this)
 *   animation: 'slide_from_right',  // 'fade' | 'none' | 'slide_from_bottom' | ...
 *   presentation: 'modal',          // present over the current screen
 *   gestureEnabled: false,          // block iOS swipe-back
 *   contentStyle: { backgroundColor: '#fff' },
 *
 *   Options from the route itself:
 *     options={({ route }) => ({ title: route.params.name })}
 *
 * GUARDING ROUTES INSTEAD OF REDIRECTING
 *   The splash-then-replace pattern here is the simplest one. Once you have real
 *   auth state, the usual next step is to render two different sets of screens:
 *
 *     {isSignedIn ? (
 *       <Stack.Screen name="Home" component={HomeScreen} />
 *     ) : (
 *       <>
 *         <Stack.Screen name="Login" component={LoginScreen} />
 *         <Stack.Screen name="Register" component={RegisterScreen} />
 *       </>
 *     )}
 *
 *   React Navigation then animates the change for you and there is no history to
 *   leak between sessions.
 *
 * NAVIGATING FROM ANY SCREEN
 *   import { useNavigation } from '@react-navigation/native';
 *   const navigation = useNavigation();
 *   navigation.navigate('Register');   // adds to history
 *   navigation.replace('Home');        // swaps the current screen
 *   navigation.goBack();
 */
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RootStackParamList } from './types';
import SplashScreen from '${paths.screen('Splash')}';
import LoginScreen from '${paths.screen('Login')}';
import RegisterScreen from '${paths.screen('Register')}';
import HomeScreen from '${paths.screen('Home')}';

// The param list generic is required: without it every Stack.Screen is typed
// against ParamListBase, and a screen component annotated with
// NativeStackScreenProps<RootStackParamList, ...> isn't assignable to it.
const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  return (
    <Stack.Navigator initialRouteName="Splash" screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Splash" component={SplashScreen} />
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Register" component={RegisterScreen} />
      <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: true }} />
    </Stack.Navigator>
  );
}
`,
    },
    {
      path: managedFile.routeTypes(layout),
      content: `${routeTypesDoc()}export type RootStackParamList = {
  Splash: undefined;
  Login: undefined;
  Register: undefined;
  Home: undefined;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
`,
    },
    {
      path: managedFile.navigationGlue(layout),
      content: `import { configureNavigationPlugin } from '@armemon-library/navigation';
${deepLinking ? "import { linking } from './navigation.config';\n" : ''}
${navigationGlueDoc({ appName: ctx.appName, hasLinking: deepLinking })}export const NavigationPlugin = configureNavigationPlugin(${deepLinking ? '{ linking }' : ''});
`,
    },
  ];

  if (deepLinking) {
    filesToWrite.push({
      path: managedFile.linking(layout),
      content: `/**
 * Deep linking — how a URL maps onto a route in RootNavigator.
 *
 * This object is handed straight to <NavigationContainer linking={...}>, and on web
 * it is what gives each screen its own URL. Without it every route renders at the
 * bare origin, whatever you navigate to.
 *
 *   /           Splash — the index route, which decides where to send you
 *   /Login      Login
 *   /Register   Register
 *   /Home       Home
 *
 * TEST A LINK WITHOUT LEAVING THE TERMINAL
 *   iOS      npx uri-scheme open "${scheme}://Login" --ios
 *   Android  npx uri-scheme open "${scheme}://Login" --android
 *   Web      just visit /Login
 *
 * Paths match case-sensitively: /Login and /login are different links. armemon uses
 * the route name as typed, so \`armemon create-screen order\` gives you /order.
 */
export const linking = {
  /**
   * Every URL shape that belongs to this app. Add your https origins here for
   * iOS Universal Links / Android App Links:
   *
   *   prefixes: ['${scheme}://', 'https://${scheme}.com'],
   *
   * Web does not use these — the browser's own address bar is the source of truth
   * there — so this list only matters on iOS and Android.
   */
  prefixes: ['${scheme}://'],

  config: {
    screens: {
      /**
       * An empty path makes Splash the index route, so "/" opens it and it then
       * replace()s to Login or Home. Give it a path of its own if you would rather
       * "/" went straight somewhere else.
       */
      Splash: '',
      Login: 'Login',
      Register: 'Register',
      Home: 'Home',

      /**
       * PATH PARAMETERS — ':name' becomes route.params.name:
       *   Profile: 'user/:id',                    // ${scheme}://user/42
       *
       * CATCH-ALL — '*' matches anything unmatched; pair it with a NotFound screen:
       *   NotFound: '*',
       */
    },
  },
};
`,
    });
  }

  const notes: string[] = [];
  if (!auth.enabled) {
    notes.push(
      'Sample screens use local state, not Redux — to wire Login/Home to real auth state, choose the Redux plugin with its "auth" slice template when creating an app (Redux added later leaves these screens as they are).',
    );
  }
  // Web needs nothing further — the browser's address bar is the source of truth
  // there, which is why /Login works the moment this app starts. Native does: the
  // scheme has to be registered with the OS, and saying nothing made a link that
  // silently never fires look finished.
  if (deepLinking) {
    notes.push(
      `Deep links work on web as soon as you run the app. On native, the "${scheme}://" scheme still has to be registered: add it to ios/${ctx.appName}/Info.plist (CFBundleURLTypes) and to android/app/src/main/AndroidManifest.xml (an intent-filter with <data android:scheme="${scheme}" />).`,
    );
  }

  return {
    npmDependencies: { ...answers.dependencyVersions },
    filesToWrite,
    appEntryContributions: {
      providerImport: { importName: 'NavigationPlugin', from: './navigation/index' },
      registerInRuntimeConfig: true,
    },
    // RootNavigator is what the App entry renders.
    provides: ['app-root'],
    postInstallNotes: notes.length > 0 ? notes : undefined,
  };
}
