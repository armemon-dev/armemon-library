/**
 * FILE: navigatorPatcher.test.ts
 * PATH: packages/cli-kit/test/navigatorPatcher.test.ts
 *
 * WHAT: The parser-backed edits `armemon create-screen`, `remove-screen` and
 *       `rename-screen` make to navigation files the user owns.
 * WHY:  These functions modify source someone has been editing, so the cases that
 *       matter are the ones an audit found breaking the first, regex-based version:
 *       example code inside doc comments, Prettier's multi-line JSX, screens with
 *       render children, files without semicolons, Windows line endings, keys that
 *       follow the screens block, and routes nested under a tab navigator. Every one
 *       is pinned here, along with idempotency — a second run must change nothing.
 */
import { describe, expect, it } from 'vitest';
import {
  detectNavigators,
  registerScreenInNavigator,
  unregisterScreenFromNavigator,
  renameScreenInNavigator,
  addRouteToParamList,
  removeRouteFromParamList,
  renameRouteInParamList,
  addLinkingRoute,
  removeLinkingRoute,
  renameLinkingRoute,
  linkingPathOf,
  nestLinkingRoutes,
  sourceSyntaxErrors,
  parseSource,
  applyEdits,
  unusedImportRemoval,
} from '../dist/index.js';

const STACK = `import React from 'react';
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
`;

const STACK_WITH_TABS = `import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import HomeScreen from '../../screens/HomeScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

function Tabs() {
  return (
    <Tab.Navigator initialRouteName="Home">
      <Tab.Screen name="Home" component={HomeScreen} />
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

/** Init's real doc comments are full of example screens. None of them are routes. */
const DOC_COMMENT = `/**
 * A modal screen (presented over the current one):
 *   <Stack.Screen
 *     name="Settings"
 *     component={SettingsScreen}
 *   />
 *   <Stack.Screen name="Details" component={DetailsScreen} />
 */
`;

const withScreens = (screens: string, header = '') =>
  STACK.replace('      <Stack.Screen name="Home" component={HomeScreen} />', screens).replace(/^/, header);

const register = (content: string, over: Record<string, unknown> = {}) =>
  registerScreenInNavigator(content, {
    componentName: 'OrderScreen',
    routeName: 'Order',
    importPath: '../../screens/OrderScreen',
    navigatorVariable: 'Stack',
    ...over,
  });

const parses = (content: string, fileName = 'RootNavigator.tsx') => expect(sourceSyntaxErrors(content, fileName)).toEqual([]);

describe('detectNavigators', () => {
  it('finds each navigator with its kind, param list, host and routes', () => {
    const [stack, tab] = detectNavigators(STACK_WITH_TABS);
    expect(stack).toMatchObject({
      variable: 'Stack', kind: 'stack', paramListType: 'RootStackParamList', host: 'RootNavigator',
      hostExport: 'default', routes: [{ name: 'Tabs', component: 'Tabs' }],
    });
    expect(tab).toMatchObject({
      variable: 'Tab', kind: 'tabs', paramListType: 'TabParamList', host: 'Tabs', hostExport: null,
      initialRouteName: 'Home', routes: [{ name: 'Home', component: 'HomeScreen' }],
    });
  });

  it('ignores example screens inside comments', () => {
    const [stack] = detectNavigators(`${DOC_COMMENT}${STACK}`);
    expect(stack!.routes.map((route) => route.name)).toEqual(['Home']);
  });

  it('reads the component a screen renders through its children', () => {
    const [stack] = detectNavigators(withScreens('      <Stack.Screen name="Home">\n        {(props) => <HomeScreen {...props} />}\n      </Stack.Screen>'));
    expect(stack!.routes).toEqual([{ name: 'Home', component: 'HomeScreen' }]);
  });

  it('finds nothing in a file that builds no navigator', () => {
    expect(detectNavigators('export default function App() { return null; }')).toEqual([]);
  });
});

describe('registerScreenInNavigator', () => {
  it('adds the screen after the last one and the import after the last import', () => {
    const { content, changed } = register(STACK);
    const lines = content.split('\n');

    expect(changed).toBe(true);
    expect(lines[lines.indexOf("import HomeScreen from '../../screens/HomeScreen';") + 1]).toBe(
      "import OrderScreen from '../../screens/OrderScreen';",
    );
    expect(lines[lines.findIndex((line) => line.includes('name="Home"')) + 1]).toBe(
      '      <Stack.Screen name="Order" component={OrderScreen} />',
    );
    parses(content);
  });

  it('is idempotent — a second run changes nothing at all', () => {
    const once = register(STACK).content;
    const twice = register(once);
    expect(twice).toMatchObject({ changed: false, already: true });
    expect(twice.content).toBe(once);
  });

  it('does not mistake example screens in comments for registered ones', () => {
    const result = register(`${DOC_COMMENT}${STACK}`, { routeName: 'Settings', componentName: 'SettingsScreen', importPath: '../../screens/SettingsScreen' });
    expect(result.changed).toBe(true);
    expect(result.content).toContain('      <Stack.Screen name="Settings" component={SettingsScreen} />');
  });

  it('puts a tab screen in the tab navigator and a stack screen in the stack', () => {
    const tab = register(STACK_WITH_TABS, { navigatorVariable: 'Tab' }).content.split('\n');
    expect(tab.findIndex((line) => line.includes('name="Order"'))).toBeLessThan(tab.findIndex((line) => line.includes('</Tab.Navigator>')));
    expect(tab.join('\n')).toContain('<Tab.Screen name="Order" component={OrderScreen} />');

    const stack = register(STACK_WITH_TABS).content.split('\n');
    expect(stack.findIndex((line) => line.includes('name="Order"'))).toBeGreaterThan(stack.findIndex((line) => line.includes('</Tab.Navigator>')));
  });

  it('adds after a multi-line screen, not inside it', () => {
    const source = withScreens('      <Stack.Screen\n        name="Home"\n        component={HomeScreen}\n        options={{ title: \'Home\' }}\n      />');
    const { content } = register(source);
    const lines = content.split('\n');

    expect(lines[lines.indexOf('      />') + 1]).toBe('      <Stack.Screen name="Order" component={OrderScreen} />');
    parses(content);
  });

  it('adds after a screen with render children, not among them', () => {
    const source = withScreens('      <Stack.Screen name="Home">\n        {(props) => <HomeScreen {...props} />}\n      </Stack.Screen>');
    const lines = register(source).content.split('\n');
    expect(lines[lines.indexOf('      </Stack.Screen>') + 1]).toBe('      <Stack.Screen name="Order" component={OrderScreen} />');
  });

  it('writes the import in a file without semicolons, without one', () => {
    const source = STACK.replace(/;$/gm, '');
    const { content, changed } = register(source);
    expect(changed).toBe(true);
    expect(content).toContain("import OrderScreen from '../../screens/OrderScreen'\n");
    parses(content);
  });

  it('keeps Windows line endings and still adds the import', () => {
    const { content } = register(STACK.replace(/\n/g, '\r\n'));
    expect(content).toContain("import OrderScreen from '../../screens/OrderScreen';\r\n");
    expect(content).toContain('<Stack.Screen name="Order" component={OrderScreen} />\r\n');
    expect(content.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('copies the quote style of existing imports', () => {
    const { content } = register(STACK.replace(/'/g, '"'));
    expect(content).toContain('import OrderScreen from "../../screens/OrderScreen";');
  });

  it('adds into an empty navigator', () => {
    const multiLine = register(withScreens('')).content;
    expect(multiLine).toContain('    <Stack.Navigator initialRouteName="Home">\n      <Stack.Screen name="Order" component={OrderScreen} />\n\n    </Stack.Navigator>');

    const oneLine = register(STACK.replace(/<Stack\.Navigator initialRouteName="Home">[\s\S]*<\/Stack\.Navigator>/, '<Stack.Navigator></Stack.Navigator>')).content;
    expect(oneLine).toContain('<Stack.Navigator>\n      <Stack.Screen name="Order" component={OrderScreen} />\n    </Stack.Navigator>');
    parses(oneLine);
  });

  it('treats a navigator holding only a comment as empty', () => {
    const { content, changed } = register(withScreens('      {/* screens go here */}'));
    expect(changed).toBe(true);
    expect(content).toContain('    <Stack.Navigator initialRouteName="Home">\n      <Stack.Screen name="Order" component={OrderScreen} />\n      {/* screens go here */}\n');
    parses(content);
  });

  it('refuses to guess inside conditional screens, and says what to add', () => {
    const source = withScreens('      {isSignedIn ? (\n        <Stack.Screen name="Home" component={HomeScreen} />\n      ) : null}');
    const result = register(source);
    expect(result).toMatchObject({ changed: false, content: source });
    expect(result.reason).toMatch(/groups or conditions/);
    expect(result.manual).toContain('<Stack.Screen name="Order" component={OrderScreen} />');
  });

  it('flags a route that already renders something else as a conflict', () => {
    expect(register(STACK, { routeName: 'Home' })).toMatchObject({ changed: false, conflict: true });
  });

  it('flags a component name the file already binds to something else', () => {
    const source = STACK.replace("import HomeScreen", "import OrderScreen from '../legacy/OrderScreen';\nimport HomeScreen");
    expect(register(source)).toMatchObject({ changed: false, conflict: true });
  });

  it('sets initialRouteName, and screen options', () => {
    const { content } = register(STACK, { initial: true, screenOptions: { presentation: 'modal', title: "Order's" } });
    expect(content).toContain('<Stack.Navigator initialRouteName="Order">');
    expect(content).toContain("options={{ presentation: 'modal', title: 'Order\\'s' }}");
    parses(content);

    expect(register(STACK_WITH_TABS, { initial: true }).content).toContain('<Stack.Navigator initialRouteName="Order" screenOptions');
  });

  it('refuses a file that does not parse', () => {
    const result = register('const x = <');
    expect(result.changed).toBe(false);
    expect(result.reason).toMatch(/doesn't parse/);
  });
});

describe('unregisterScreenFromNavigator', () => {
  it('undoes a registration exactly', () => {
    const registered = register(STACK).content;
    expect(unregisterScreenFromNavigator(registered, { routeName: 'Order' }).content).toBe(STACK);
  });

  it('removes a multi-line screen whole', () => {
    const source = withScreens('      <Stack.Screen name="Home" component={HomeScreen} />\n      <Stack.Screen\n        name="Order"\n        component={OrderScreen}\n      />');
    const { content } = unregisterScreenFromNavigator(source, { routeName: 'Order' });
    expect(content).not.toContain('Order');
    parses(content);
  });

  it('keeps an import another screen still uses', () => {
    const source = withScreens('      <Stack.Screen name="Home" component={HomeScreen} />\n      <Stack.Screen name="Start" component={HomeScreen} />');
    const { content } = unregisterScreenFromNavigator(source, { routeName: 'Start' });
    expect(content).toContain("import HomeScreen from '../../screens/HomeScreen';");
    expect(content).not.toContain('name="Start"');
  });

  it('refuses to remove the initial route unless told to drop it', () => {
    expect(unregisterScreenFromNavigator(STACK, { routeName: 'Home' })).toMatchObject({ changed: false, conflict: true });

    const { content } = unregisterScreenFromNavigator(STACK, { routeName: 'Home', dropInitialRoute: true });
    expect(content).toContain('<Stack.Navigator>');
    expect(content).not.toContain('HomeScreen');
  });

  it('refuses a screen inside an expression', () => {
    const source = withScreens('      {isSignedIn ? <Stack.Screen name="Home" component={HomeScreen} /> : null}');
    expect(unregisterScreenFromNavigator(source, { routeName: 'Home', dropInitialRoute: true }).reason).toMatch(/inside an expression/);
  });

  it('reports a route that is not there as already done', () => {
    expect(unregisterScreenFromNavigator(STACK, { routeName: 'Nope' })).toMatchObject({ changed: false, already: true });
  });
});

describe('renameScreenInNavigator', () => {
  it('renames the route, the initial route and the component binding', () => {
    const { content } = renameScreenInNavigator(STACK, { from: 'Home', to: 'Start', fromComponent: 'HomeScreen', toComponent: 'StartScreen' });
    expect(content).toContain('<Stack.Navigator initialRouteName="Start">');
    expect(content).toContain('<Stack.Screen name="Start" component={StartScreen} />');
    expect(content).toContain("import StartScreen from '../../screens/HomeScreen';");
    parses(content);
  });

  it('is idempotent', () => {
    const once = renameScreenInNavigator(STACK, { from: 'Home', to: 'Start', fromComponent: 'HomeScreen', toComponent: 'StartScreen' }).content;
    expect(renameScreenInNavigator(once, { from: 'Home', to: 'Start', fromComponent: 'HomeScreen', toComponent: 'StartScreen' })).toMatchObject({ changed: false, already: true });
  });
});

describe('param lists', () => {
  const TYPES = 'export type RootStackParamList = {\n  Home: undefined;\n  Settings: undefined;\n};\n';
  const add = (content: string, over: Record<string, unknown> = {}) =>
    addRouteToParamList(content, { routeName: 'Order', typeName: 'RootStackParamList', ...over });

  it('adds the route after the last entry, at its indentation', () => {
    expect(add(TYPES).content).toBe('export type RootStackParamList = {\n  Home: undefined;\n  Settings: undefined;\n  Order: undefined;\n};\n');
    expect(add(TYPES, { paramsType: '{ id: string }' }).content).toContain('  Order: { id: string };');
  });

  it('follows the separator style: semicolons, commas, or none', () => {
    expect(add('export type RootStackParamList = {\n  Home: undefined,\n};\n').content).toContain('  Order: undefined,\n');
    expect(add('export type RootStackParamList = {\n  Home: undefined\n};\n').content).toContain('  Home: undefined\n  Order: undefined\n');
    expect(add('export type RootStackParamList = { Home: undefined; Feed: undefined };\n').content).toBe(
      'export type RootStackParamList = { Home: undefined; Feed: undefined; Order: undefined };\n',
    );
  });

  it('handles interfaces and empty lists', () => {
    expect(add('export interface RootStackParamList {\n  Home: undefined;\n}\n').content).toContain('  Order: undefined;\n}');
    expect(add('export type RootStackParamList = {};\n').content).toBe('export type RootStackParamList = {\n  Order: undefined;\n};\n');
  });

  it('edits the real list, not the example in the doc comment above it', () => {
    const types = `/**
 * NESTED NAVIGATORS
 *     export type TabParamList = { Feed: undefined; Settings: undefined };
 *     export type RootStackParamList = {
 *       Tabs: NavigatorScreenParams<TabParamList>;
 *     };
 */
import type { NavigatorScreenParams } from '@react-navigation/native';

export type TabParamList = {
  Home: undefined;
};

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList>;
};
`;
    const { content } = add(types, { routeName: 'Details' });
    const tabs = content.slice(content.indexOf('export type TabParamList = {\n'), content.indexOf('export type RootStackParamList = {\n  Tabs'));
    const root = content.slice(content.indexOf('export type RootStackParamList = {\n  Tabs'));
    expect(tabs).not.toContain('Details');
    expect(root).toContain('  Details: undefined;');
  });

  it('is idempotent and reports what it cannot edit', () => {
    const once = add(TYPES).content;
    expect(add(once)).toMatchObject({ changed: false, already: true, content: once });
    expect(add(TYPES, { typeName: 'TabParamList' }).reason).toMatch(/no TabParamList/);
    expect(add('export type RootStackParamList = Record<string, undefined>;\n').reason).toMatch(/isn't a plain object type/);
  });

  it('removes and renames entries', () => {
    expect(removeRouteFromParamList(TYPES, { routeName: 'Settings', typeName: 'RootStackParamList' }).content).toBe(
      'export type RootStackParamList = {\n  Home: undefined;\n};\n',
    );
    expect(renameRouteInParamList(TYPES, { from: 'Settings', to: 'Prefs', typeName: 'RootStackParamList' }).content).toContain('  Prefs: undefined;');
  });
});

describe('linking config', () => {
  /** The shape init generates: comments full of example screens and keys after `screens`. */
  const INIT_LINKING = `export const linking = {
  prefixes: ['myapp://'],

  config: {
    screens: {
      Home: 'Home',
      Screen2: 'Screen2',

      /**
       * NESTED NAVIGATORS — mirror the nesting:
       *   Tabs: {
       *     path: 'app',
       *     screens: { Home: 'Home', Settings: 'Settings' },
       *   },
       */
    },

    /**
     * Which route sits underneath a deep-linked screen:
     *   initialRouteName: 'Home',
     */
  },
};
`;
  const lineAfter = (content: string, needle: string) => {
    const lines = content.split('\n');
    return lines[lines.findIndex((line) => line.includes(needle)) + 1];
  };

  it("adds to init's own config — the example in its comment is not a nested navigator", () => {
    const result = addLinkingRoute(INIT_LINKING, { routeName: 'Order', path: 'order' });
    expect(result.changed).toBe(true);
    expect(lineAfter(result.content, "Screen2: 'Screen2'")).toBe("      Order: 'order',");
    parses(result.content, 'navigation.config.ts');
  });

  it('stays inside screens when other keys follow the block', () => {
    const source = INIT_LINKING.replace("    /**\n     * Which route", "    initialRouteName: 'Home',\n\n    /**\n     * Which route");
    expect(lineAfter(addLinkingRoute(source, { routeName: 'Order', path: 'order' }).content, "Screen2: 'Screen2'")).toBe("      Order: 'order',");
  });

  it('nests a tab screen under its parent route', () => {
    const nested = "export const linking = {\n  config: {\n    screens: {\n      Tabs: {\n        screens: {\n          Home: 'Home',\n        },\n      },\n    },\n  },\n};\n";
    expect(lineAfter(addLinkingRoute(nested, { routeName: 'Order', path: 'order', nesting: ['Tabs'] }).content, "Home: 'Home'")).toBe("          Order: 'order',");

    const created = addLinkingRoute(INIT_LINKING, { routeName: 'Order', path: 'order', nesting: ['Tabs'] }).content;
    expect(created).toContain("      Screen2: 'Screen2',\n      Tabs: {\n        screens: {\n          Order: 'order',\n        },\n      },\n");

    const fromString = addLinkingRoute(INIT_LINKING.replace("Screen2: 'Screen2'", "Tabs: 'tabs'"), { routeName: 'Order', path: 'order', nesting: ['Tabs'] }).content;
    expect(fromString).toContain("      Tabs: {\n        path: 'tabs',\n        screens: {\n          Order: 'order',\n        },\n      },\n");
    parses(fromString, 'navigation.config.ts');
  });

  it('writes the full form when params need parsing', () => {
    const { content } = addLinkingRoute(INIT_LINKING, { routeName: 'Order', path: 'order/:id', parse: { id: 'Number' } });
    expect(content).toContain("      Order: {\n        path: 'order/:id',\n        parse: {\n          id: Number,\n        },\n      },\n");
    expect(linkingPathOf(content, { routeName: 'Order' })).toBe('order/:id');
  });

  it('follows configs without trailing commas, and one-line configs', () => {
    expect(addLinkingRoute("export const linking = {\n  config: {\n    screens: {\n      Home: 'home'\n    }\n  }\n};\n", { routeName: 'Order', path: 'order' }).content)
      .toContain("      Home: 'home',\n      Order: 'order'\n    }");
    expect(addLinkingRoute("export const linking = { config: { screens: { Home: 'home' } } };\n", { routeName: 'Order', path: 'order' }).content)
      .toBe("export const linking = { config: { screens: { Home: 'home', Order: 'order' } } };\n");
  });

  it('keeps Windows line endings', () => {
    const { content } = addLinkingRoute(INIT_LINKING.replace(/\n/g, '\r\n'), { routeName: 'Order', path: 'order' });
    expect(content).toContain("      Order: 'order',\r\n");
    expect(content.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('is idempotent, including for a route already nested elsewhere', () => {
    const once = addLinkingRoute(INIT_LINKING, { routeName: 'Order', path: 'order' }).content;
    expect(addLinkingRoute(once, { routeName: 'Order', path: 'order' })).toMatchObject({ changed: false, already: true, content: once });
    expect(addLinkingRoute(INIT_LINKING, { routeName: 'Home', path: 'home', nesting: ['Tabs'] })).toMatchObject({ already: true });
  });

  it('removes and renames entries', () => {
    expect(removeLinkingRoute(INIT_LINKING, { routeName: 'Screen2' }).content).not.toContain("Screen2: 'Screen2'");
    const renamed = renameLinkingRoute(INIT_LINKING, { from: 'Screen2', to: 'Profile', path: 'profile' }).content;
    expect(renamed).toContain("      Profile: 'profile',");
    expect(linkingPathOf(renamed, { routeName: 'Profile' })).toBe('profile');
  });

  it('finds the trailing comma past a comment that contains one', () => {
    const source = "export const linking = {\n  config: {\n    screens: {\n      Home: 'home' /* first, default */,\n    },\n  },\n};\n";
    const { content } = addLinkingRoute(source, { routeName: 'Order', path: 'order' });
    expect(content).toContain("      Home: 'home' /* first, default */,\n      Order: 'order',\n");
    parses(content, 'navigation.config.ts');
    expect(removeLinkingRoute(source, { routeName: 'Home' }).content).not.toContain('Home');
  });

  it('creates config.screens when the linking config has none', () => {
    expect(addLinkingRoute("export const linking = {\n  prefixes: ['myapp://'],\n};\n", { routeName: 'Order', path: 'order' }).content)
      .toBe("export const linking = {\n  prefixes: ['myapp://'],\n  config: {\n    screens: {\n      Order: 'order',\n    },\n  },\n};\n");
    expect(addLinkingRoute("export const linking = {\n  prefixes: ['myapp://'],\n  config: {},\n};\n", { routeName: 'Order', path: 'order', nesting: ['Tabs'] }).content)
      .toContain("  config: {\n    screens: {\n      Tabs: {\n        screens: {\n          Order: 'order',\n        },\n      },\n    },\n  },");
  });

  it('updates an existing entry only when asked: path, parsers, and parsers that no longer apply', () => {
    const link = "export const linking = {\n  config: {\n    screens: {\n      Order: 'Order',\n    },\n  },\n};\n";
    expect(addLinkingRoute(link, { routeName: 'Order', path: 'order/:id' })).toMatchObject({ changed: false, already: true });

    const full = addLinkingRoute(link, { routeName: 'Order', path: 'order/:id', parse: { id: 'Number' }, update: { path: true, parsers: true } }).content;
    expect(full).toContain("      Order: {\n        path: 'order/:id',\n        parse: {\n          id: Number,\n        },\n      },\n");

    const cleared = addLinkingRoute(full, { routeName: 'Order', path: 'order/:id', update: { parsers: true }, clearParsers: ['id'] }).content;
    expect(cleared).toContain("      Order: {\n        path: 'order/:id',\n      },\n");
    parses(cleared, 'navigation.config.ts');
  });

  it('moves flat links for nested routes under their parent', () => {
    const flat = "export const linking = {\n  config: {\n    screens: {\n      Tabs: 'app',\n      Home: 'Home',\n      Feed: 'feed',\n      Details: 'details',\n    },\n  },\n};\n";
    const result = nestLinkingRoutes(flat, { routes: ['Home', 'Feed'], nesting: ['Tabs'] });

    expect(result.names).toEqual(['Home', 'Feed']);
    expect(result.content).toContain(
      "      Tabs: {\n        path: 'app',\n        screens: {\n          Home: 'Home',\n          Feed: 'feed',\n        },\n      },\n      Details: 'details',\n",
    );
    expect(nestLinkingRoutes(result.content, { routes: ['Home', 'Feed'], nesting: ['Tabs'] })).toMatchObject({ already: true });
  });
});

describe('moving links and trimming imports', () => {
  it('drops a flat duplicate of a link that is already nested', () => {
    const source = "export const linking = {\n  config: {\n    screens: {\n      Home: 'Home',\n      Tabs: {\n        screens: {\n          Home: 'Home',\n        },\n      },\n    },\n  },\n};\n";
    const result = nestLinkingRoutes(source, { routes: ['Home'], nesting: ['Tabs'] });
    expect(result).toMatchObject({ changed: true, names: ['Home'] });
    expect(result.content).toBe("export const linking = {\n  config: {\n    screens: {\n      Tabs: {\n        screens: {\n          Home: 'Home',\n        },\n      },\n    },\n  },\n};\n");
  });

  it('re-indents a multi-line entry it moves', () => {
    const source = "export const linking = {\n  config: {\n    screens: {\n      Home: {\n        path: 'home',\n        exact: true,\n      },\n      Tabs: {\n        screens: {},\n      },\n    },\n  },\n};\n";
    expect(nestLinkingRoutes(source, { routes: ['Home'], nesting: ['Tabs'] }).content).toBe(
      "export const linking = {\n  config: {\n    screens: {\n      Tabs: {\n        screens: {\n          Home: {\n            path: 'home',\n            exact: true,\n          },\n        },\n      },\n    },\n  },\n};\n",
    );
  });

  it('puts an entry added to an empty block above the comment in it', () => {
    const source = "export const linking = {\n  config: {\n    screens: {\n      /** examples */\n    },\n  },\n};\n";
    expect(addLinkingRoute(source, { routeName: 'Order', path: 'order' }).content).toContain("    screens: {\n      Order: 'order',\n      /** examples */\n    },");
  });

  it('removes one name from an import that brings in several', () => {
    const navigator = "import React from 'react';\nimport { createNativeStackNavigator } from '@react-navigation/native-stack';\nimport { HomeScreen, OrderScreen } from '../../screens';\n\nconst Stack = createNativeStackNavigator();\n\nexport default function RootNavigator() {\n  return (\n    <Stack.Navigator>\n      <Stack.Screen name=\"Home\" component={HomeScreen} />\n      <Stack.Screen name=\"Order\" component={OrderScreen} />\n    </Stack.Navigator>\n  );\n}\n";
    expect(unregisterScreenFromNavigator(navigator, { routeName: 'Order' }).content).toContain("import { HomeScreen } from '../../screens';");
    expect(unregisterScreenFromNavigator(navigator, { routeName: 'Home' }).content).toContain("import { OrderScreen } from '../../screens';");

    const mixed = "import Home, { Order } from './screens';\n";
    const parsed = parseSource(mixed, 'mixed.ts');
    expect(applyEdits(mixed, [unusedImportRemoval(mixed, parsed, 'Home')!])).toBe("import { Order } from './screens';\n");
    expect(applyEdits(mixed, [unusedImportRemoval(mixed, parsed, 'Order')!])).toBe("import Home from './screens';\n");
  });
});

describe('destructured and inline navigators', () => {
  const DESTRUCTURED = `import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen from '../../screens/HomeScreen';

const { Navigator, Screen } = createNativeStackNavigator();

export default function RootNavigator() {
  return (
    <Navigator initialRouteName="Home">
      <Screen name="Home" component={HomeScreen} />
    </Navigator>
  );
}
`;

  it('detects, registers into and unregisters from a destructured navigator', () => {
    expect(detectNavigators(DESTRUCTURED)).toMatchObject([
      { variable: 'Navigator', navigatorTag: 'Navigator', screenTag: 'Screen', kind: 'stack', routes: [{ name: 'Home', component: 'HomeScreen' }] },
    ]);
    const registered = registerScreenInNavigator(DESTRUCTURED, {
      componentName: 'OrderScreen', routeName: 'Order', importPath: '../../screens/OrderScreen', navigatorVariable: 'Navigator',
    }).content;
    expect(registered).toContain('      <Screen name="Order" component={OrderScreen} />');
    expect(unregisterScreenFromNavigator(registered, { routeName: 'Order' }).content).toBe(DESTRUCTURED);
  });

  it('knows which screen renders an inline navigator, and that the screen renders a navigator, not a component', () => {
    const inline = `import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import HomeScreen from '../../screens/HomeScreen';

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
`;
    const [stack, tab] = detectNavigators(inline);
    expect(stack).toMatchObject({ routes: [{ name: 'Main', component: null }], renderedBy: null });
    expect(tab).toMatchObject({ renderedBy: { variable: 'Stack', route: 'Main' } });
  });
});

describe('re-running a registration with new options', () => {
  it('sets the initial route and merges options into an existing registration', () => {
    const registered = register(STACK).content;
    const updated = register(registered, { initial: true, screenOptions: { presentation: 'modal', title: 'Orders' } });

    expect(updated.changed).toBe(true);
    expect(updated.content).toContain('<Stack.Navigator initialRouteName="Order">');
    expect(updated.content).toContain("<Stack.Screen name=\"Order\" component={OrderScreen} options={{ presentation: 'modal', title: 'Orders' }} />");
    expect(register(updated.content, { initial: true, screenOptions: { presentation: 'modal', title: 'Orders' } })).toMatchObject({ changed: false, already: true });
    expect(register(updated.content, { screenOptions: { title: 'Invoices' } }).content).toContain("title: 'Invoices'");
    parses(updated.content);
  });

  it('refuses to change options it cannot read', () => {
    const computed = register(STACK).content.replace('component={OrderScreen} />', 'component={OrderScreen} options={({ route }) => ({ title: route.name })} />');
    const result = register(computed, { screenOptions: { title: 'Orders' } });
    expect(result).toMatchObject({ changed: false });
    expect(result.reason).toMatch(/computed/);
  });

  it('replaces a param type only when asked', () => {
    const types = 'export type RootStackParamList = {\n  Order: undefined;\n};\n';
    expect(addRouteToParamList(types, { routeName: 'Order', typeName: 'RootStackParamList', paramsType: '{ id: number }' })).toMatchObject({ already: true });
    expect(addRouteToParamList(types, { routeName: 'Order', typeName: 'RootStackParamList', paramsType: '{ id: number }', replaceType: true }).content)
      .toContain('  Order: { id: number };');
  });
});
