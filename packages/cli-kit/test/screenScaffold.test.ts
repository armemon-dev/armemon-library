/**
 * FILE: screenScaffold.test.ts
 * PATH: packages/cli-kit/test/screenScaffold.test.ts
 *
 * WHAT: Screen naming and the files a screen is made of.
 * WHY:  `armemon create-screen OrderScreen.jsx` and `armemon create-screen order`
 *       have to mean the same thing, because people will type both. And the folder
 *       shape is the whole point of the layout change — if buildScreenFiles quietly
 *       stops emitting the READMEs, the guidance disappears and nothing else notices.
 */
import { describe, expect, it } from 'vitest';
import {
  normalizeScreenName,
  validateScreenName,
  validateLinkingPath,
  parseRouteParams,
  linkingPathParams,
  mergeRouteParams,
  paramListEntryType,
  linkingParsersFor,
  navigateExample,
  screenPathFor,
  buildScreenFiles,
  convertFilesToJavaScript,
} from '../dist/index.js';

describe('normalizeScreenName', () => {
  it.each([
    ['OrderScreen', 'Order'],
    ['Order', 'Order'],
    ['OrderScreen.jsx', 'Order'],
    ['OrderScreen.tsx', 'Order'],
    ['order', 'Order'],
    ['order-screen', 'Order'],
    ['order_screen', 'Order'],
    ['src/screens/OrderScreen/index.tsx', 'Order'],
    ['screens/OrderScreen', 'Order'],
    ['./src/screens/OrderScreen/', 'Order'],
    ['  "OrderScreen"  ', 'Order'],
    ['order-history', 'OrderHistory'],
  ])('reads %j as the %s route', (input, routeName) => {
    expect(normalizeScreenName(input).routeName).toBe(routeName);
  });

  it('derives the component, folder and link path together', () => {
    expect(normalizeScreenName('order-history')).toEqual({
      routeName: 'OrderHistory',
      componentName: 'OrderHistoryScreen',
      folder: 'src/screens/OrderHistoryScreen',
      linkingPath: 'order-history',
    });
  });

  it.each([
    ['tytScreen', 'Tyt', 'tyt'],
    ['TytScreen', 'Tyt', 'Tyt'],
    ['tyt', 'Tyt', 'tyt'],
    ['OrderHistory', 'OrderHistory', 'OrderHistory'],
    ['orderHistory', 'OrderHistory', 'orderHistory'],
    ['order-history', 'OrderHistory', 'order-history'],
    ['order_screen', 'Order', 'order'],
    ['order-Screen', 'Order', 'order'],
    ['orderscreen', 'Orderscreen', 'orderscreen'],
    ['order history', 'OrderHistory', 'order-history'],
    ['src/screens/tytScreen/index.tsx', 'Tyt', 'tyt'],
  ])('keeps %j as typed in the link path, while the route is %s', (input, routeName, linkingPath) => {
    expect(normalizeScreenName(input)).toMatchObject({ routeName, linkingPath });
  });

  it('rejects "Screen" on its own with a usable message', () => {
    expect(() => normalizeScreenName('Screen')).toThrow(/not a route name on its own/);
  });

  it('rejects a name that cannot be an identifier', () => {
    expect(() => normalizeScreenName('2Order')).toThrow(/capital letter/);
  });
});

describe('validateScreenName', () => {
  it('accepts a plain route name', () => {
    expect(validateScreenName('Home')).toBeUndefined();
  });

  it('rejects the Screen suffix, which armemon appends itself', () => {
    expect(validateScreenName('HomeScreen')).toMatch(/Leave off/);
  });
});

describe('validateLinkingPath', () => {
  it.each(['tyt', 'Tyt', 'OrderHistory', 'order-history', 'orders/new', 'user_2', 'order/:id', 'order/:id/:tab?', ':id'])(
    'accepts %j',
    (value) => {
      expect(validateLinkingPath(value)).toBeUndefined();
    },
  );

  it.each(["it's", '/order', '-order', 'order history', '', 'order/', 'order//new', 'order/:', 'order/:1'])('rejects %j', (value) => {
    expect(validateLinkingPath(value)).toMatch(/starting with a letter or number/);
  });
});

describe('route params', () => {
  it('parses name:type lists, defaulting to string', () => {
    expect(parseRouteParams('id:string, page?:number,draft:boolean,slug')).toEqual([
      { name: 'id', type: 'string', optional: false },
      { name: 'page', type: 'number', optional: true },
      { name: 'draft', type: 'boolean', optional: false },
      { name: 'slug', type: 'string', optional: false },
    ]);
  });

  it('rejects unknown types and duplicates with a usable message', () => {
    expect(() => parseRouteParams('id:date')).toThrow(/name:type/);
    expect(() => parseRouteParams('id,id')).toThrow(/twice/);
  });

  it('reads params out of a deep-link path, and lets declared types win', () => {
    const fromPath = linkingPathParams('order/:id/:tab?');
    expect(fromPath).toEqual([
      { name: 'id', type: 'string', optional: false },
      { name: 'tab', type: 'string', optional: true },
    ]);
    expect(mergeRouteParams([{ name: 'id', type: 'number', optional: false }], fromPath)).toEqual([
      { name: 'id', type: 'number', optional: false },
      { name: 'tab', type: 'string', optional: true },
    ]);
  });

  it('writes the param list entry and the linking parsers', () => {
    const params = parseRouteParams('id:number,draft?:boolean,slug');
    expect(paramListEntryType([])).toBe('undefined');
    expect(paramListEntryType(params)).toBe('{ id: number; draft?: boolean; slug: string }');
    expect(linkingParsersFor(params, 'typescript')).toEqual({ id: 'Number', draft: "(value: string) => value === 'true'" });
    expect(linkingParsersFor(params, 'javascript')?.draft).toBe("(value) => value === 'true'");
    expect(linkingParsersFor(parseRouteParams('slug'), 'typescript')).toBeUndefined();
  });

  it('writes a navigate() call that reaches the route through its navigators', () => {
    expect(navigateExample('Order', [], [])).toBe("navigation.navigate('Order')");
    expect(navigateExample('Order', [], parseRouteParams('id:number'))).toBe("navigation.navigate('Order', { id: 1 })");
    expect(navigateExample('Order', ['Tabs'], parseRouteParams('id:number'))).toBe(
      "navigation.navigate('Tabs', { screen: 'Order', params: { id: 1 } })",
    );
    expect(navigateExample('Feed', ['Main', 'Home'], [])).toBe("navigation.navigate('Main', { screen: 'Home', params: { screen: 'Feed' } })");
  });
});

describe('buildScreenFiles', () => {
  const base = { routeName: 'Order', language: 'typescript' as const, kind: 'blank' as const };

  it('full shape is exactly the index plus four folder READMEs', () => {
    expect(buildScreenFiles({ ...base, shape: 'full' }).map((f) => f.path)).toEqual([
      'src/screens/OrderScreen/index.tsx',
      'src/screens/OrderScreen/components/README.md',
      'src/screens/OrderScreen/hooks/README.md',
      'src/screens/OrderScreen/utils/README.md',
      'src/screens/OrderScreen/assets/README.md',
    ]);
  });

  it('flat shape is exactly one file', () => {
    expect(buildScreenFiles({ ...base, shape: 'flat' }).map((f) => f.path)).toEqual([
      'src/screens/OrderScreen/index.tsx',
    ]);
  });

  it('writes a .jsx index for a JavaScript app', () => {
    const files = buildScreenFiles({ ...base, shape: 'flat', language: 'javascript' });
    expect(files[0]!.path).toBe('src/screens/OrderScreen/index.jsx');
  });

  it('every README says what belongs in its folder', () => {
    const files = buildScreenFiles({ ...base, shape: 'full' });
    for (const readme of files.filter((f) => f.path.endsWith('README.md'))) {
      expect(readme.content.length, readme.path).toBeGreaterThan(120);
      expect(readme.content, readme.path).toContain('OrderScreen');
    }
  });

  /**
   * These files are written by the init flow, not by a plugin plan, so
   * generatedCode.test.ts never sees them — the .ts→.js rewrite would not reach a
   * stale extension in their prose either. They have to be right by construction.
   */
  it.each(['blank', 'placeholder', 'reference', 'welcome', 'welcome-themed'] as const)(
    'the %s screen names no TypeScript file in a JavaScript app',
    async (kind) => {
      const files = buildScreenFiles({ routeName: 'Order', shape: 'full', language: 'javascript', kind });
      const { files: converted } = await convertFilesToJavaScript(files);

      for (const file of converted) {
        const named = file.content.match(/[\w./-]+\.tsx?\b/g) ?? [];
        expect(named, `${file.path} names ${named.join(', ')}`).toEqual([]);
      }
    },
  );
});

describe('buildScreenFiles with route params', () => {
  const params = parseRouteParams('id');

  it('types the params at the component when the navigator has a param list', () => {
    const [index] = buildScreenFiles({
      routeName: 'Order', shape: 'flat', language: 'typescript', kind: 'blank', params,
      typing: {
        propsType: 'NativeStackScreenProps', propsPackage: '@react-navigation/native-stack',
        paramListType: 'RootStackParamList', paramListImport: '../../armemon/navigation/types',
      },
    });
    expect(index!.content).toContain("import type { NativeStackScreenProps } from '@react-navigation/native-stack';");
    expect(index!.content).toContain("import type { RootStackParamList } from '../../armemon/navigation/types';");
    expect(index!.content).toContain("type Props = NativeStackScreenProps<RootStackParamList, 'Order'>;");
    expect(index!.content).toContain('export default function OrderScreen({ route }: Props)');
    expect(index!.content).toContain("navigation.navigate('Order', { id: 'abc' });");
  });

  it('reads them with useRoute when nothing types the navigator', async () => {
    const files = buildScreenFiles({ routeName: 'Order', shape: 'flat', language: 'javascript', kind: 'blank', params });
    expect(files[0]!.content).toContain('const route = useRoute();');
    const { files: converted } = await convertFilesToJavaScript(files);
    expect(converted[0]!.content).toContain('{JSON.stringify(route.params)}');
  });
});

describe('screenPathFor', () => {
  it('is the one definition of where a screen lives', () => {
    expect(screenPathFor('Order')).toBe('src/screens/OrderScreen/index.tsx');
    expect(screenPathFor('Order', 'hooks/README.md')).toBe('src/screens/OrderScreen/hooks/README.md');
  });
});
