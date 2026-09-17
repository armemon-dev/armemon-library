/**
 * FILE: navigationDiscovery.test.ts
 * PATH: packages/cli-kit/test/navigationDiscovery.test.ts
 *
 * WHAT: Mapping an app's navigators from disk — files, nesting, param lists.
 * WHY:  Every screen command decides where to write from this map. A tab navigator
 *       mapped without its parent route produces deep links that open nothing; a param
 *       list mapped to the wrong file types routes into the wrong navigator. Both
 *       shipped once; both are pinned here on real files.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appSourceFiles, discoverNavigation, findAppRoot, importsNameFrom } from '../dist/index.js';

let app: string;

const write = async (relative: string, content: string) => {
  const target = path.join(app, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, 'utf8');
};
const at = (relative: string) => path.join(app, relative);

beforeEach(async () => {
  app = await fs.mkdtemp(path.join(os.tmpdir(), 'armemon-discovery-'));
  await write('armemon.config.ts', 'const config = {};\nexport default config;\n');
});
afterEach(async () => {
  await fs.rm(app, { recursive: true, force: true });
});

describe('discoverNavigation', () => {
  it('nests the tab navigator of a stack-with-tabs app under its route', async () => {
    await write('src/armemon/navigation/RootNavigator.tsx', `import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { RootStackParamList, TabParamList } from './types';
import HomeScreen from '../../screens/HomeScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

function Tabs() {
  return (
    <Tab.Navigator>
      <Tab.Screen name="Home" component={HomeScreen} />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Tabs" component={Tabs} />
    </Stack.Navigator>
  );
}
`);
    await write('src/armemon/navigation/types.ts', 'export type TabParamList = { Home: undefined };\nexport type RootStackParamList = { Tabs: undefined };\n');
    await write('src/armemon/navigation/navigation.config.ts', 'export const linking = {};\n');

    const map = await discoverNavigation(app);
    expect(map.rootFile).toBe(at('src/armemon/navigation/RootNavigator.tsx'));
    expect(map.linkingFile).toBe(at('src/armemon/navigation/navigation.config.ts'));
    expect(map.navigators.find((navigator) => navigator.variable === 'Stack')).toMatchObject({
      nesting: [],
      paramListName: 'RootStackParamList',
      paramListFile: at('src/armemon/navigation/types.ts'),
      screenProps: { type: 'NativeStackScreenProps', package: '@react-navigation/native-stack' },
    });
    expect(map.navigators.find((navigator) => navigator.variable === 'Tab')).toMatchObject({
      nesting: ['Tabs'],
      paramListName: 'TabParamList',
      screenProps: { type: 'BottomTabScreenProps', package: '@react-navigation/bottom-tabs' },
    });
  });

  it('follows a navigator into another file, with its factory declared in a third', async () => {
    await write('src/armemon/navigation/RootNavigator.tsx', `import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RootStackParamList } from './types';
import HomeTabs from '../../navigation/HomeTabs';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Main" component={HomeTabs} />
    </Stack.Navigator>
  );
}
`);
    await write('src/navigation/navigators.ts', `import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { TabParamList } from '../armemon/navigation/types';

export const Tab = createBottomTabNavigator<TabParamList>();
`);
    await write('src/navigation/HomeTabs.tsx', `import React from 'react';
import { Tab } from './navigators';
import FeedScreen from '../screens/FeedScreen';

export default function HomeTabs() {
  return (
    <Tab.Navigator>
      <Tab.Screen name="Feed" component={FeedScreen} />
    </Tab.Navigator>
  );
}
`);
    await write('src/armemon/navigation/types.ts', 'export type RootStackParamList = { Main: undefined };\nexport type TabParamList = { Feed: undefined };\n');

    const map = await discoverNavigation(app);
    expect(map.navigators.find((navigator) => navigator.variable === 'Tab')).toMatchObject({
      file: at('src/navigation/HomeTabs.tsx'),
      declaredHere: false,
      kind: 'tabs',
      nesting: ['Main'],
      paramListName: 'TabParamList',
      paramListFile: at('src/armemon/navigation/types.ts'),
      routes: [{ name: 'Feed', component: 'FeedScreen' }],
    });
  });

  it('reports a navigation file that does not parse instead of guessing at it', async () => {
    await write('src/armemon/navigation/RootNavigator.tsx', 'const Stack = createNativeStackNavigator(\n');
    const map = await discoverNavigation(app);
    expect(map.unparsable).toEqual([at('src/armemon/navigation/RootNavigator.tsx')]);
    expect(map.navigators).toEqual([]);
  });

  it('returns an empty map for an app without navigation', async () => {
    expect(await discoverNavigation(app)).toMatchObject({ rootFile: null, navigators: [] });
  });
});

describe('discoverNavigation on less common layouts', () => {
  it('follows a navigator through a barrel index.ts', async () => {
    await write('src/armemon/navigation/RootNavigator.tsx', `import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { HomeTabs } from '../../navigation';

const Stack = createNativeStackNavigator();

export default function RootNavigator() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Main" component={HomeTabs} />
    </Stack.Navigator>
  );
}
`);
    await write('src/navigation/index.ts', "export { default as HomeTabs } from './HomeTabs';\n");
    await write('src/navigation/HomeTabs.tsx', `import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { TabParamList } from '../armemon/navigation/types';
import HomeScreen from '../screens/HomeScreen';

const Tab = createBottomTabNavigator<TabParamList>();

export default function HomeTabs() {
  return (
    <Tab.Navigator>
      <Tab.Screen name="Home" component={HomeScreen} />
    </Tab.Navigator>
  );
}
`);
    await write('src/armemon/navigation/types.ts', 'export type TabParamList = { Home: undefined };\n');

    const map = await discoverNavigation(app);
    expect(map.navigators.find((navigator) => navigator.variable === 'Tab')).toMatchObject({
      file: at('src/navigation/HomeTabs.tsx'),
      nesting: ['Main'],
      paramListName: 'TabParamList',
      paramListFile: at('src/armemon/navigation/types.ts'),
    });
  });

  it('nests an inline navigator under the screen that renders it', async () => {
    await write('src/armemon/navigation/RootNavigator.tsx', `import React from 'react';
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
`);
    const map = await discoverNavigation(app);
    expect(map.navigators.map((navigator) => [navigator.variable, navigator.nesting])).toEqual([['Stack', []], ['Tab', ['Main']]]);
  });

  it('types an untyped root navigator through the global RootParamList', async () => {
    await write('src/armemon/navigation/RootNavigator.tsx', `import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen from '../../screens/HomeScreen';

const Stack = createNativeStackNavigator();

export default function RootNavigator() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Home" component={HomeScreen} />
    </Stack.Navigator>
  );
}
`);
    await write('src/armemon/navigation/types.ts', `export type RootStackParamList = { Home: undefined };

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
`);
    const map = await discoverNavigation(app);
    expect(map.rootParamList).toEqual({ file: at('src/armemon/navigation/types.ts'), name: 'RootStackParamList' });
    expect(map.navigators[0]).toMatchObject({ paramListName: 'RootStackParamList', paramListInferred: true });
  });
});

describe('importsNameFrom', () => {
  it('knows whether a file takes a name from a barrel', async () => {
    await write('src/screens/index.ts', "export { default as OrderScreen } from './OrderScreen';\n");
    const barrel = at('src/screens/index.ts');
    const file = at('src/App.tsx');

    expect(await importsNameFrom("import { OrderScreen } from './screens';\n", file, barrel, 'OrderScreen')).toBe(true);
    expect(await importsNameFrom("import { HomeScreen } from './screens';\n", file, barrel, 'OrderScreen')).toBe(false);
    expect(await importsNameFrom("import * as screens from './screens';\n", file, barrel, 'OrderScreen')).toBe(true);
    expect(await importsNameFrom("export { OrderScreen } from './screens';\n", file, barrel, 'OrderScreen')).toBe(true);
    expect(await importsNameFrom("import { OrderScreen } from '@/screens';\n", file, barrel, 'OrderScreen')).toBe(true);
  });
});

describe('appSourceFiles', () => {
  it('lists src and the App entry, skipping node_modules and declarations', async () => {
    await write('App.tsx', 'export default null;\n');
    await write('src/screens/HomeScreen/index.tsx', 'export default null;\n');
    await write('src/types/env.d.ts', 'declare const x: string;\n');
    await write('src/node_modules/pkg/index.js', 'module.exports = 1;\n');

    expect((await appSourceFiles(app)).sort()).toEqual([at('App.tsx'), at('src/screens/HomeScreen/index.tsx')].sort());
  });

  // Tests and root files reach into src/ and the managed zone too — a rename, removal
  // or move that skips them leaves a test mocking a module that no longer exists.
  it('includes the test folders and the files at the app root, but not native folders', async () => {
    await write('App.tsx', 'export default null;\n');
    await write('index.js', "import App from './App';\n");
    await write('jest.setup.js', "jest.mock('./src/screens/HomeScreen');\n");
    await write('__tests__/App.test.tsx', 'test("x", () => {});\n');
    await write('e2e/home.e2e.ts', 'export {};\n');
    await write('android/app/src/main/assets/index.android.bundle.js', 'var x;\n');
    await write('ios/build/generated.js', 'var x;\n');

    expect((await appSourceFiles(app)).sort()).toEqual(
      [at('App.tsx'), at('index.js'), at('jest.setup.js'), at('__tests__/App.test.tsx'), at('e2e/home.e2e.ts')].sort(),
    );
  });
});

describe('findAppRoot', () => {
  it('finds the app from any folder inside it', async () => {
    await fs.mkdir(at('src/screens'), { recursive: true });
    expect(await findAppRoot(at('src/screens'))).toBe(app);
    expect(await findAppRoot(app)).toBe(app);
  });
});
