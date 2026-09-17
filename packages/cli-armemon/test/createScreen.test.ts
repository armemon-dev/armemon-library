/**
 * FILE: createScreen.test.ts
 * PATH: packages/cli-armemon/test/createScreen.test.ts
 *
 * WHAT: `armemon create-screen` against real apps on disk — hand-written ones, and
 *       every navigation preset `armemon init` generates, in TypeScript and JavaScript.
 * WHY:  This command edits files the user owns. The first version passed against a
 *       ten-line sample app and failed on the files init actually writes: examples in
 *       their doc comments sent routes into the wrong param list and blocked every
 *       deep link. So the presets are tested as generated, runs are repeated to prove
 *       a second one changes nothing, and App.tsx is checked untouched — its own prose
 *       promises it is never regenerated.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { sourceSyntaxErrors } from '@armemon-library/cli-kit';
import { ChangeSet, commit, runCreateScreenFlow } from '../dist/index.js';
import { NAV, captureStdout, makeApp, resetCliState, scaffoldNavigation, writeConfig, type TestApp } from './support/screenApps';

let app: TestApp;

beforeEach(async () => {
  app = await makeApp();
});
afterEach(async () => {
  resetCliState();
  await app.remove();
});

const create = (over: Record<string, unknown> = {}) =>
  runCreateScreenFlow({ name: 'Order', cwd: app.root, allAccept: true, full: true, verify: false, ...over } as never);

const json = async (over: Record<string, unknown> = {}) =>
  JSON.parse(await captureStdout(() => create({ json: true, ...over })));

const STACK = `import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RootStackParamList } from './types';
import HomeScreen from '../../src/screens/HomeScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  return (
    <Stack.Navigator initialRouteName="Home">
      <Stack.Screen name="Home" component={HomeScreen} />
    </Stack.Navigator>
  );
}
`;

/** The small hand-written app — navigation armemon didn't generate. */
async function buildApp(options: { navigation?: boolean; linking?: boolean; navigator?: string } = {}): Promise<void> {
  const { navigation = true, linking = true } = options;
  await writeConfig(app);
  if (!navigation) return;
  await app.write(`${NAV}/RootNavigator.tsx`, options.navigator ?? STACK);
  await app.write(`${NAV}/types.ts`, 'export type RootStackParamList = {\n  Home: undefined;\n};\n');
  if (linking) {
    await app.write(`${NAV}/navigation.config.ts`, "export const linking = {\n  prefixes: ['fixture://'],\n  config: {\n    screens: {\n      Home: 'home',\n    },\n  },\n};\n");
  }
}

const parsesClean = async (...files: string[]) => {
  for (const file of files) expect(sourceSyntaxErrors(await app.read(file), file), file).toEqual([]);
};

describe('create-screen on a hand-written app', () => {
  it('creates the folder with its guidance READMEs', async () => {
    await buildApp();
    await create();
    for (const file of ['index.tsx', 'components/README.md', 'hooks/README.md', 'utils/README.md', 'assets/README.md']) {
      await expect(app.read(`src/screens/OrderScreen/${file}`)).resolves.toBeTruthy();
    }
  });

  it('registers the route in all three places', async () => {
    await buildApp();
    await create();

    expect(await app.read(`${NAV}/RootNavigator.tsx`)).toContain('<Stack.Screen name="Order" component={OrderScreen} />');
    expect(await app.read(`${NAV}/RootNavigator.tsx`)).toContain("import OrderScreen from '../../src/screens/OrderScreen';");
    expect(await app.read(`${NAV}/types.ts`)).toContain('Order: undefined;');
    expect(await app.read(`${NAV}/navigation.config.ts`)).toContain("Order: 'Order',");
  });

  it('changes nothing at all on a second run', async () => {
    await buildApp();
    await create();
    const after = await Promise.all([`${NAV}/RootNavigator.tsx`, `${NAV}/types.ts`, `${NAV}/navigation.config.ts`].map((file) => app.read(file)));

    await create({ force: true });

    expect(await Promise.all([`${NAV}/RootNavigator.tsx`, `${NAV}/types.ts`, `${NAV}/navigation.config.ts`].map((file) => app.read(file)))).toEqual(after);
  });

  it('refuses to overwrite an existing screen without --force', async () => {
    await buildApp();
    await create();
    await expect(create()).rejects.toThrow(/already exists/);
  });

  it('leaves the navigator alone with --no-register', async () => {
    await buildApp();
    const before = await app.read(`${NAV}/RootNavigator.tsx`);
    await create({ register: false });
    expect(await app.read(`${NAV}/RootNavigator.tsx`)).toBe(before);
    await expect(app.read('src/screens/OrderScreen/index.tsx')).resolves.toBeTruthy();
  });

  it('skips the deep link with --no-link but still registers the route', async () => {
    await buildApp();
    const before = await app.read(`${NAV}/navigation.config.ts`);
    await create({ noLink: true });
    expect(await app.read(`${NAV}/navigation.config.ts`)).toBe(before);
    expect(await app.read(`${NAV}/types.ts`)).toContain('Order: undefined;');
  });

  it('works in an app with no navigation, and never touches App', async () => {
    await buildApp({ navigation: false });
    const before = await app.read('App.tsx');
    await create();
    await expect(app.read('src/screens/OrderScreen/index.tsx')).resolves.toBeTruthy();
    expect(await app.read('App.tsx')).toBe(before);
  });

  it('errors rather than pretending when --register has no navigator', async () => {
    await buildApp({ navigation: false });
    await expect(create({ register: true })).rejects.toThrow(/no RootNavigator/);
  });

  it('registers without asking when --register is passed', async () => {
    await buildApp();
    await create({ register: true });
    expect(await app.read(`${NAV}/RootNavigator.tsx`)).toContain('<Stack.Screen name="Order" component={OrderScreen} />');
  });

  it('accepts a filename as the screen name, and runs from any folder inside the app', async () => {
    await buildApp();
    await create({ name: 'OrderScreen.jsx', cwd: path.join(app.root, 'src') });
    await expect(app.read('src/screens/OrderScreen/index.tsx')).resolves.toBeTruthy();
  });

  it('refuses a directory that was never scaffolded', async () => {
    await expect(create()).rejects.toThrow(/armemon\.config/);
  });

  it('re-aligns a hand-shaped navigator without rewriting its line endings', async () => {
    const styled = STACK
      .replace('      <Stack.Screen name="Home" component={HomeScreen} />', '      <Stack.Screen\n        name="Home"\n        component={HomeScreen}\n        options={{ title: \'Home\' }}\n      />')
      .replace(/;$/gm, '')
      .replace(/\n/g, '\r\n');
    await buildApp({ navigator: styled });
    await create();

    const navigator = await app.read(`${NAV}/RootNavigator.tsx`);
    // Re-alignment restores armemon's style in the managed zone — the semicolon the
    // fixture stripped comes back, and the hand-split <Stack.Screen> collapses. What
    // it must NOT do is touch the line endings: rewriting a CRLF checkout to LF would
    // turn every one-screen change into a whole-file diff on Windows.
    expect(navigator).toContain("import OrderScreen from '../../src/screens/OrderScreen';\r\n");
    expect(navigator).toContain('<Stack.Screen name="Order" component={OrderScreen} />\r\n');
    expect(navigator.replace(/\r\n/g, '')).not.toContain('\n');
    await parsesClean(`${NAV}/RootNavigator.tsx`);
  });
});

describe('create-screen flags', () => {
  it('refuses --full and --flat together, before writing anything', async () => {
    await buildApp();
    await expect(create({ flat: true })).rejects.toThrow(/--full and --flat/);
    expect(await app.exists('src/screens/OrderScreen')).toBe(false);
  });

  it('refuses navigator flags with --no-register', async () => {
    await buildApp();
    await expect(create({ register: false, link: 'order', modal: true })).rejects.toThrow(/--link, --modal mean nothing with --no-register/);
  });

  it('refuses a --link path that would break the linking config', async () => {
    await buildApp();
    const before = await app.read(`${NAV}/navigation.config.ts`);
    for (const link of ["it's", '/order', 'order history']) {
      await expect(create({ link })).rejects.toThrow(/not a usable deep-link path/);
    }
    expect(await app.read(`${NAV}/navigation.config.ts`)).toBe(before);
    expect(await app.exists('src/screens/OrderScreen')).toBe(false);
  });

  it.each([
    ['tytScreen', "Tyt: 'tyt',"],
    ['TytScreen', "Tyt: 'Tyt',"],
  ])('names the component TytScreen for %j but keeps the typed case in the link', async (name, entry) => {
    await buildApp();
    await create({ name });
    await expect(app.read('src/screens/TytScreen/index.tsx')).resolves.toContain('TytScreen');
    expect(await app.read(`${NAV}/navigation.config.ts`)).toContain(entry);
  });

  it('refuses a --navigator the app does not have, instead of guessing', async () => {
    await buildApp();
    const before = await app.read(`${NAV}/RootNavigator.tsx`);
    await expect(create({ navigator: 'tabs' })).rejects.toMatchObject({
      message: expect.stringMatching(/doesn't match a navigator/),
      hint: 'This app has: Stack (stack) in armemon/navigation/RootNavigator.tsx.',
    });
    expect(await app.read(`${NAV}/RootNavigator.tsx`)).toBe(before);
  });

  it('sets the initial route, modal presentation and title', async () => {
    await scaffoldNavigation(app);
    await create({ initial: true, modal: true, title: 'Orders' });
    const navigator = await app.read(`${NAV}/RootNavigator.tsx`);
    expect(navigator).toContain('<Stack.Navigator initialRouteName="Order">');
    expect(navigator).toContain("<Stack.Screen name=\"Order\" component={OrderScreen} options={{ presentation: 'modal', title: 'Orders' }} />");
    await parsesClean(`${NAV}/RootNavigator.tsx`);
  });

  it('refuses --modal outside a stack', async () => {
    await scaffoldNavigation(app, { navigatorType: 'tabs' });
    await expect(create({ modal: true })).rejects.toThrow(/--modal only works in a stack navigator/);
  });

  it('types route params in the param list, the deep link and the screen itself', async () => {
    await scaffoldNavigation(app);
    await create({ link: 'order/:id', params: 'id:number,draft?:boolean' });

    expect(await app.read(`${NAV}/types.ts`)).toContain('  Order: { id: number; draft?: boolean };');
    expect(await app.read(`${NAV}/navigation.config.ts`)).toContain(
      "      Order: {\n        path: 'order/:id',\n        parse: {\n          id: Number,\n          draft: (value: string) => value === 'true',\n        },\n      },",
    );
    const screen = await app.read('src/screens/OrderScreen/index.tsx');
    expect(screen).toContain("import type { RootStackParamList } from '../../../armemon/navigation/types';");
    expect(screen).toContain("type Props = NativeStackScreenProps<RootStackParamList, 'Order'>;");
    expect(screen).toContain("navigation.navigate('Order', { id: 1, draft: true });");
    await parsesClean(`${NAV}/types.ts`, `${NAV}/navigation.config.ts`, 'src/screens/OrderScreen/index.tsx');
  });

  it('refuses unreadable params', async () => {
    await buildApp();
    await expect(create({ params: 'id:date' })).rejects.toThrow(/--params "id:date" can't be read/);
  });

  it('--dry-run shows the change and writes nothing', async () => {
    await scaffoldNavigation(app);
    const before = await app.read(`${NAV}/RootNavigator.tsx`);
    const summary = await json({ dryRun: true });

    expect(summary).toMatchObject({ ok: true, dryRun: true, created: expect.arrayContaining(['src/screens/OrderScreen/index.tsx']) });
    expect(await app.exists('src/screens/OrderScreen')).toBe(false);
    expect(await app.read(`${NAV}/RootNavigator.tsx`)).toBe(before);
  });

  it('--json prints nothing but a parseable summary', async () => {
    await scaffoldNavigation(app);
    const output = await captureStdout(() => create({ json: true }));
    const summary = JSON.parse(output);

    expect(output.trimStart().startsWith('{')).toBe(true);
    expect(summary).toMatchObject({
      ok: true,
      command: 'create-screen',
      routeName: 'Order',
      navigator: { variable: 'Stack', kind: 'stack', file: `${NAV}/RootNavigator.tsx`, nesting: [] },
      linkingPath: 'Order',
      verification: null,
    });
    expect(summary.edits.map((edit: { status: string }) => edit.status)).toEqual(['changed', 'changed', 'changed']);
  });

  it('--force replaces the index and says what it kept', async () => {
    await buildApp();
    await create();
    await app.write('src/screens/OrderScreen/components/OrderRow.tsx', 'export default null;\n');

    const summary = await json({ force: true, full: undefined, flat: true });
    expect(summary.kept).toContain('src/screens/OrderScreen/components/OrderRow.tsx');
    expect(await app.exists('src/screens/OrderScreen/components/OrderRow.tsx')).toBe(true);
  });
});

describe('create-screen on every init preset', () => {
  it('stack with deep links: registers, types and links, even a name used in the docs', async () => {
    await scaffoldNavigation(app);
    await create();
    await create({ name: 'Settings' });

    const navigator = await app.read(`${NAV}/RootNavigator.tsx`);
    expect(navigator).toContain('<Stack.Screen name="Order" component={OrderScreen} />');
    expect(navigator).toContain('<Stack.Screen name="Settings" component={SettingsScreen} />');
    expect(await app.read(`${NAV}/types.ts`)).toContain('  Screen2: undefined;\n  Order: undefined;\n  Settings: undefined;\n};');
    expect(await app.read(`${NAV}/navigation.config.ts`)).toContain("      Screen2: 'Screen2',\n      Order: 'Order',\n      Settings: 'Settings',\n");
    await parsesClean(`${NAV}/RootNavigator.tsx`, `${NAV}/types.ts`, `${NAV}/navigation.config.ts`);
  });

  it('stack-with-tabs, into the tabs: the tab list and a link nested under Tabs', async () => {
    await scaffoldNavigation(app, { navigatorType: 'stack-with-tabs' });
    await create({ navigator: 'tabs' });

    expect(await app.read(`${NAV}/RootNavigator.tsx`)).toContain('<Tab.Screen name="Order" component={OrderScreen} />');
    const types = await app.read(`${NAV}/types.ts`);
    expect(types).toContain('export type TabParamList = {\n  Home: undefined;\n  Screen2: undefined;\n  Order: undefined;\n};');
    expect(await app.read(`${NAV}/navigation.config.ts`)).toContain("        screens: {\n          Home: 'Home',\n          Screen2: 'Screen2',\n          Order: 'Order',\n        },");
  });

  it('stack-with-tabs: the screen documents the navigate() call that type-checks from anywhere', async () => {
    await scaffoldNavigation(app, { navigatorType: 'stack-with-tabs' });
    await create({ navigator: 'tabs', params: 'id:number' });
    expect(await app.read('src/screens/OrderScreen/index.tsx')).toContain(
      "navigation.navigate('Tabs', { screen: 'Order', params: { id: 1 } });",
    );
  });

  it('stack-with-tabs, into the stack: the root list — not TabParamList — and a root link', async () => {
    await scaffoldNavigation(app, { navigatorType: 'stack-with-tabs' });
    await create({ name: 'Details', navigator: 'stack' });

    expect(await app.read(`${NAV}/RootNavigator.tsx`)).toContain('<Stack.Screen name="Details" component={DetailsScreen} />');
    const types = await app.read(`${NAV}/types.ts`);
    expect(types).toContain('export type RootStackParamList = {\n  Tabs: NavigatorScreenParams<TabParamList>;\n  Details: undefined;\n};');
    expect(types).toContain('export type TabParamList = {\n  Home: undefined;\n  Screen2: undefined;\n};');
    expect(await app.read(`${NAV}/navigation.config.ts`)).toContain("      },\n      Details: 'Details',\n");
  });

  it('stack-with-tabs: a name that is already a route stops before writing anything', async () => {
    await scaffoldNavigation(app, { navigatorType: 'stack-with-tabs' });
    const before = await app.read(`${NAV}/types.ts`);
    await expect(create({ name: 'Tabs', navigator: 'stack' })).rejects.toThrow(/"Tabs" is already a route in <Stack.Navigator>/);
    expect(await app.exists('src/screens/TabsScreen')).toBe(false);
    expect(await app.read(`${NAV}/types.ts`)).toBe(before);
  });

  it('drawer', async () => {
    await scaffoldNavigation(app, { navigatorType: 'drawer' });
    await create();
    expect(await app.read(`${NAV}/RootNavigator.tsx`)).toContain('<Drawer.Screen name="Order" component={OrderScreen} />');
    expect(await app.read(`${NAV}/types.ts`)).toContain('  Order: undefined;');
  });

  it('the sample auth flow', async () => {
    await scaffoldNavigation(app, { sampleAuthFlow: true, enableDeepLinking: false });
    await create();
    expect(await app.read(`${NAV}/RootNavigator.tsx`)).toContain(
      '      <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: true }} />\n      <Stack.Screen name="Order" component={OrderScreen} />',
    );
    await parsesClean(`${NAV}/RootNavigator.tsx`);
  });

  it('a JavaScript app, with params read through useRoute', async () => {
    await scaffoldNavigation(app, {}, 'javascript');
    await create({ link: 'order/:id' });

    expect(await app.read(`${NAV}/RootNavigator.jsx`)).toContain('<Stack.Screen name="Order" component={OrderScreen} />');
    expect(await app.read(`${NAV}/navigation.config.js`)).toContain("Order: 'order/:id',");
    const screen = await app.read('src/screens/OrderScreen/index.jsx');
    expect(screen).toContain('const route = useRoute();');
    expect(screen).not.toMatch(/: Props|import type/);
  });
});

describe('create-screen with navigators in other files', () => {
  it('registers in the file that renders the navigator and links under its parent route', async () => {
    await writeConfig(app);
    await app.write(`${NAV}/RootNavigator.tsx`, `import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RootStackParamList } from './types';
import HomeTabs from '../../src/navigation/HomeTabs';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Main" component={HomeTabs} />
    </Stack.Navigator>
  );
}
`);
    await app.write('src/navigation/HomeTabs.tsx', `import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { TabParamList } from '../../armemon/navigation/types';
import FeedScreen from '../screens/FeedScreen';

const Tab = createBottomTabNavigator<TabParamList>();

export default function HomeTabs() {
  return (
    <Tab.Navigator>
      <Tab.Screen name="Feed" component={FeedScreen} />
    </Tab.Navigator>
  );
}
`);
    await app.write(`${NAV}/types.ts`, 'export type RootStackParamList = {\n  Main: undefined;\n};\n\nexport type TabParamList = {\n  Feed: undefined;\n};\n');
    await app.write(`${NAV}/navigation.config.ts`, "export const linking = {\n  prefixes: ['myapp://'],\n  config: {\n    screens: {\n      Main: {\n        screens: {\n          Feed: 'feed',\n        },\n      },\n    },\n  },\n};\n");

    await create({ navigator: 'Tab' });

    const tabs = await app.read('src/navigation/HomeTabs.tsx');
    expect(tabs).toContain("import OrderScreen from '../screens/OrderScreen';");
    expect(tabs).toContain('<Tab.Screen name="Order" component={OrderScreen} />');
    expect(await app.read(`${NAV}/types.ts`)).toContain('export type TabParamList = {\n  Feed: undefined;\n  Order: undefined;\n};');
    expect(await app.read(`${NAV}/navigation.config.ts`)).toContain("          Feed: 'feed',\n          Order: 'Order',\n");
  });
});

describe('create-screen when it cannot finish', () => {
  it('skips an edit it cannot make safely, says what to add, and exits 1', async () => {
    await buildApp({
      navigator: STACK.replace('      <Stack.Screen name="Home" component={HomeScreen} />', '      {isSignedIn ? <Stack.Screen name="Home" component={HomeScreen} /> : null}'),
    });
    const summary = await json();

    expect(summary.ok).toBe(false);
    expect(summary.edits[0]).toMatchObject({ status: 'skipped', reason: expect.stringMatching(/groups or conditions/) });
    expect(summary.edits[0].manual).toContain('<Stack.Screen name="Order" component={OrderScreen} />');
    expect(summary.edits.slice(1).map((edit: { reason: string }) => edit.reason)).toEqual([
      'left alone until the screen is registered',
      'left alone until the screen is registered',
    ]);
    expect(process.exitCode).toBe(1);
  });

  it('puts every file back when a write fails partway', async () => {
    await writeConfig(app);
    // A folder can't be made inside a file, so this write fails after the create.
    await app.write('blocker', 'a file, not a folder\n');
    const changes = new ChangeSet(app.root);
    await changes.stage(path.join(app.root, 'blocker/folder/file.ts'), 'export {};\n', null);

    await expect(commit(changes, { create: [{ path: 'src/screens/NewScreen/index.tsx', content: 'export {};\n' }] })).rejects.toThrow(/put back/);
    expect(await app.exists('src/screens/NewScreen')).toBe(false);
    expect(await app.exists('src/screens')).toBe(false);
  });
});

describe('create-screen re-runs and less common apps', () => {
  it('re-running with --force applies new params, link and initial route', async () => {
    await scaffoldNavigation(app);
    await create();
    const summary = await json({ force: true, params: 'id:number', link: 'order/:id', initial: true });

    expect(summary.ok).toBe(true);
    expect(summary.edits.map((edit: { status: string }) => edit.status)).toEqual(['changed', 'changed', 'changed']);
    expect(await app.read(`${NAV}/types.ts`)).toContain('  Order: { id: number };');
    expect(await app.read(`${NAV}/RootNavigator.tsx`)).toContain('<Stack.Navigator initialRouteName="Order">');
    expect(await app.read(`${NAV}/navigation.config.ts`)).toContain("      Order: {\n        path: 'order/:id',\n        parse: {\n          id: Number,\n        },\n      },");
  });

  it('a plain re-run keeps the deep-link path already chosen', async () => {
    await scaffoldNavigation(app);
    await create({ link: 'orders' });
    await create({ force: true });
    expect(await app.read(`${NAV}/navigation.config.ts`)).toContain("Order: 'orders',");
  });

  it('--force removes an old index with another extension, which Metro would load first', async () => {
    await buildApp();
    await app.write('src/screens/OrderScreen/index.js', 'export default function OrderScreen() { return null; }\n');
    const summary = await json({ force: true });

    expect(await app.exists('src/screens/OrderScreen/index.js')).toBe(false);
    expect(await app.exists('src/screens/OrderScreen/index.tsx')).toBe(true);
    expect(summary.edits).toContainEqual(expect.objectContaining({ file: 'src/screens/OrderScreen/index.js', status: 'changed' }));
  });

  it('moves the flat tab links an older init wrote under Tabs', async () => {
    await scaffoldNavigation(app, { navigatorType: 'stack-with-tabs' });
    const linking = await app.read(`${NAV}/navigation.config.ts`);
    await app.write(
      `${NAV}/navigation.config.ts`,
      linking.replace("      Tabs: {\n        screens: {\n          Home: 'Home',\n          Screen2: 'Screen2',\n        },\n      },", "      Home: 'Home',\n      Screen2: 'Screen2',"),
    );
    const summary = await json({ navigator: 'tabs' });

    expect(await app.read(`${NAV}/navigation.config.ts`)).toContain(
      "      Tabs: {\n        screens: {\n          Home: 'Home',\n          Screen2: 'Screen2',\n          Order: 'Order',\n        },\n      },",
    );
    expect(summary.edits.some((edit: { action?: string }) => /moved the links for Home, Screen2 under Tabs/.test(edit.action ?? ''))).toBe(true);
    await parsesClean(`${NAV}/navigation.config.ts`);
  });

  it('explains how to move a screen to another navigator', async () => {
    await scaffoldNavigation(app, { navigatorType: 'stack-with-tabs' });
    await create({ navigator: 'stack' });
    await expect(create({ navigator: 'tabs', force: true })).rejects.toMatchObject({
      hint: expect.stringContaining('armemon remove-screen Order --keep-files, then armemon create-screen Order --force --navigator Tab'),
    });
  });

  it('drops a flat duplicate of a tab link that is already nested', async () => {
    await scaffoldNavigation(app, { navigatorType: 'stack-with-tabs' });
    const linking = await app.read(`${NAV}/navigation.config.ts`);
    await app.write(`${NAV}/navigation.config.ts`, linking.replace('      Tabs: {', "      Home: 'Home',\n      Tabs: {"));

    const summary = await json({ navigator: 'tabs' });
    expect(summary.ok).toBe(true);
    expect(await app.read(`${NAV}/navigation.config.ts`)).not.toMatch(/^ {6}Home: 'Home',$/m);
  });

  it('registers in a destructured navigator', async () => {
    await buildApp({
      navigator: STACK
        .replace('const Stack = createNativeStackNavigator<RootStackParamList>();', 'const { Navigator, Screen } = createNativeStackNavigator<RootStackParamList>();')
        .replace(/Stack\.Navigator/g, 'Navigator')
        .replace('<Stack.Screen', '<Screen'),
    });
    await create();
    expect(await app.read(`${NAV}/RootNavigator.tsx`)).toContain('      <Screen name="Order" component={OrderScreen} />');
    expect(await app.read(`${NAV}/types.ts`)).toContain('Order: undefined;');
  });

  it('warns when a required param has no place in the deep link', async () => {
    await scaffoldNavigation(app);
    const summary = await json({ params: 'id:number', link: 'order' });
    expect(summary.ok).toBe(true);
    expect(summary.warnings).toEqual([expect.stringMatching(/^id is required, but the deep link order has no :id/)]);
  });

  it("types a route through the app's global RootParamList when its navigator names none", async () => {
    await scaffoldNavigation(app, { enableDeepLinking: false });
    const navigator = await app.read(`${NAV}/RootNavigator.tsx`);
    await app.write(`${NAV}/RootNavigator.tsx`, navigator.replace('createNativeStackNavigator<RootStackParamList>()', 'createNativeStackNavigator()'));
    await create();
    expect(await app.read(`${NAV}/types.ts`)).toContain('  Order: undefined;');
  });

  it('links a screen of an inline navigator under the screen that renders it', async () => {
    await writeConfig(app);
    await app.write(`${NAV}/RootNavigator.tsx`, `import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import HomeScreen from '../../src/screens/HomeScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

export default function RootNavigator() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Main">
        {() => (
          <Tab.Navigator>
            <Tab.Screen name="Home" component={HomeScreen} />
          </Tab.Navigator>
        )}
      </Stack.Screen>
    </Stack.Navigator>
  );
}
`);
    await app.write(`${NAV}/navigation.config.ts`, "export const linking = {\n  prefixes: ['myapp://'],\n  config: {\n    screens: {\n      Main: {\n        screens: {\n          Home: 'home',\n        },\n      },\n    },\n  },\n};\n");
    await create({ navigator: 'Tab' });

    expect(await app.read(`${NAV}/RootNavigator.tsx`)).toContain('            <Tab.Screen name="Order" component={OrderScreen} />');
    expect(await app.read(`${NAV}/navigation.config.ts`)).toContain("          Home: 'home',\n          Order: 'Order',\n");
  });

  it('registers in a navigator reached through a barrel file', async () => {
    await writeConfig(app);
    await app.write(`${NAV}/RootNavigator.tsx`, `import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { HomeTabs } from '../../src/navigation';

const Stack = createNativeStackNavigator();

export default function RootNavigator() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Main" component={HomeTabs} />
    </Stack.Navigator>
  );
}
`);
    await app.write('src/navigation/index.ts', "export { default as HomeTabs } from './HomeTabs';\n");
    await app.write('src/navigation/HomeTabs.tsx', `import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import HomeScreen from '../screens/HomeScreen';

const Tab = createBottomTabNavigator();

export default function HomeTabs() {
  return (
    <Tab.Navigator>
      <Tab.Screen name="Home" component={HomeScreen} />
    </Tab.Navigator>
  );
}
`);
    await create({ navigator: 'Tab' });

    const tabs = await app.read('src/navigation/HomeTabs.tsx');
    expect(tabs).toContain("import OrderScreen from '../screens/OrderScreen';");
    expect(tabs).toContain('<Tab.Screen name="Order" component={OrderScreen} />');
  });
});
