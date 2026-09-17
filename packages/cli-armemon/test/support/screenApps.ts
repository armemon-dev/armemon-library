/**
 * FILE: screenApps.ts
 * PATH: packages/cli-armemon/test/support/screenApps.ts
 *
 * WHAT: Throwaway apps on disk for the screen-command suites: an empty one to write
 *       by hand, or one holding exactly the navigation files `armemon init` generates
 *       for a given preset, converted to JavaScript when asked.
 * WHY:  The first create-screen passed against a hand-written ten-line app and broke
 *       on init's real output. Building fixtures from the wizard itself means the
 *       suites always test the files users actually have.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { convertFilesToJavaScript, setAutoAccept, setLogStream } from '@armemon-library/cli-kit';
import type { PluginInstallPlan, WizardContext } from '@armemon-library/config-types';

export const NAV = 'armemon/navigation';

export interface TestApp {
  root: string;
  read(relative: string): Promise<string>;
  write(relative: string, content: string): Promise<void>;
  exists(relative: string): Promise<boolean>;
  remove(): Promise<void>;
}

export async function makeApp(): Promise<TestApp> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'armemon-screens-'));
  return {
    root,
    read: (relative) => fs.readFile(path.join(root, relative), 'utf8'),
    write: async (relative, content) => {
      const target = path.join(root, relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, 'utf8');
    },
    exists: (relative) => fs.access(path.join(root, relative)).then(() => true, () => false),
    remove: () => fs.rm(root, { recursive: true, force: true }),
  };
}

const APP_ENTRY = `import React from 'react';
import { KitProvider } from '@armemon-library/core';
import './armemon/runtime.generated';
import RootNavigator from './armemon/navigation/RootNavigator';

export default function App() {
  return (
    <KitProvider>
      <RootNavigator />
    </KitProvider>
  );
}
`;

export async function writeConfig(app: TestApp, language: 'typescript' | 'javascript' = 'typescript'): Promise<void> {
  const config = { appName: 'MyApp', rnVersion: '0.76.0', platforms: ['ios', 'android'], packageManager: 'npm', language, plugins: {} };
  await app.write(language === 'javascript' ? 'armemon.config.js' : 'armemon.config.ts', `const config = ${JSON.stringify(config, null, 2)};\nexport default config;\n`);
  await app.write('package.json', JSON.stringify({ name: 'fixture', scripts: {} }, null, 2));
  await app.write(language === 'javascript' ? 'App.jsx' : 'App.tsx', APP_ENTRY);
}

export const NAV_ANSWERS = {
  navigatorType: 'stack',
  initialRouteName: 'Home',
  screenCount: 2,
  enableDeepLinking: true,
  typedRoutes: true,
  dependencyVersions: {},
  sampleAuthFlow: false,
};

/** An app holding exactly what the navigation wizard generates for these answers. */
export async function scaffoldNavigation(
  app: TestApp,
  answers: Record<string, unknown> = {},
  language: 'typescript' | 'javascript' = 'typescript',
): Promise<void> {
  const wizard = (await import('../../../plugin-navigation/dist/wizard/index.mjs')).default as {
    plan(answers: unknown, ctx: WizardContext): Promise<PluginInstallPlan>;
  };
  const ctx: WizardContext = {
    appRoot: app.root,
    cwd: app.root,
    appName: 'MyApp',
    rnVersion: '0.76.0',
    packageManager: 'npm',
    platforms: ['ios', 'android'],
    language,
    flags: {},
    alreadyAnsweredByOtherPlugins: {},
  };
  const plan = await wizard.plan({ ...NAV_ANSWERS, ...answers }, ctx);
  const files = language === 'javascript' ? (await convertFilesToJavaScript(plan.filesToWrite)).files : plan.filesToWrite;

  await writeConfig(app, language);
  for (const file of files) await app.write(file.path, file.content);
}

/**
 * A store config in the shape the Redux wizard generates, for the slice commands.
 *
 * The commented-out example is kept deliberately: it is character-for-character what
 * a real entry looks like, so it is the case that tells a parser-backed patcher apart
 * from a line-matching one.
 */
export async function scaffoldReduxStore(
  app: TestApp,
  language: 'typescript' | 'javascript' = 'typescript',
): Promise<void> {
  await writeConfig(app, language);
  const extension = language === 'javascript' ? 'js' : 'ts';
  const typeImport =
    language === 'javascript' ? '' : "import type { ReduxConfig } from '@armemon-library/redux';\n";
  const typeAnnotation = language === 'javascript' ? '' : ': ReduxConfig';

  await app.write(
    `armemon/redux/store.config.${extension}`,
    `${typeImport}import { counterSlice } from '../../src/store/slices/counterSlice';

export const reduxConfig${typeAnnotation} = {
  // armemon create-slice Cart writes the slice and adds both lines below for you.
  // By hand: create the file, import it above, add a line here.
  //   import { cartSlice } from '../../src/store/slices/cartSlice';
  //   cart: cartSlice,
  slices: {
    counter: counterSlice,
  },

  persist: { enabled: false },
};
`,
  );

  await app.write(
    `src/store/slices/counterSlice.${extension}`,
    "export const counterSlice = { name: 'counter', initialState: { value: 0 }, reducers: {} };\n",
  );
}

/** Where an app scaffolded before the managed zone moved to the app root kept it. */
export const LEGACY_NAV = 'src/armemon/navigation';

/**
 * An app in the OLD layout, for the migration `armemon sync` performs.
 *
 * Written out literally rather than generated and then moved: deriving it with the
 * same rewriting code sync uses would make any test built on it circular. Every
 * cross-zone specifier here is one level shorter than its current-layout twin,
 * which is exactly what the move has to fix.
 */
export async function scaffoldLegacyNavigation(app: TestApp): Promise<void> {
  await writeConfig(app);

  await app.write(
    'App.tsx',
    `import React from 'react';
import { KitProvider } from '@armemon-library/core';
import './src/armemon/runtime.generated';
import RootNavigator from './src/armemon/navigation/RootNavigator';

export default function App() {
  return (
    <KitProvider>
      <RootNavigator />
    </KitProvider>
  );
}
`,
  );

  await app.write('src/armemon/runtime.generated.ts', 'export const registered = true;\n');

  await app.write(
    `${LEGACY_NAV}/RootNavigator.tsx`,
    `import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RootStackParamList } from './types';
import HomeScreen from '../../screens/HomeScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  return (
    <Stack.Navigator initialRouteName="Home">
      <Stack.Screen name="Home" component={HomeScreen} />
    </Stack.Navigator>
  );
}
`,
  );

  await app.write(
    `${LEGACY_NAV}/types.ts`,
    'export type RootStackParamList = {\n  Home: undefined;\n};\n',
  );

  await app.write(
    `${LEGACY_NAV}/navigation.config.ts`,
    "export const linking = {\n  prefixes: ['myapp://'],\n  config: {\n    screens: {\n      Home: 'Home',\n    },\n  },\n};\n",
  );

  await app.write(
    'src/screens/HomeScreen/index.tsx',
    `import React from 'react';
import { View, Text } from 'react-native';
import type { RootStackParamList } from '../../armemon/navigation/types';

export default function HomeScreen() {
  const route: keyof RootStackParamList = 'Home';
  return (
    <View>
      <Text>{route}</Text>
    </View>
  );
}
`,
  );
}

/** Everything written to stdout while `run` runs — the JSON a script would read. */
export async function captureStdout(run: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    await run();
  } finally {
    process.stdout.write = original;
  }
  return chunks.join('');
}

/** Flows set process-wide state; a leftover exit code of 1 would fail the whole run. */
export function resetCliState(): void {
  process.exitCode = 0;
  setAutoAccept(false);
  setLogStream('stdout');
}
