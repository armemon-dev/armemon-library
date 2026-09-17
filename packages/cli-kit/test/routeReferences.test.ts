/**
 * FILE: routeReferences.test.ts
 * PATH: packages/cli-kit/test/routeReferences.test.ts
 *
 * WHAT: Finding and renaming the places an app names a route or imports from a
 *       screen's folder.
 * WHY:  remove-screen refuses while these exist and rename-screen rewrites them, so a
 *       miss is a runtime crash in a file the command never mentioned — and a false
 *       hit (a title that happens to say "Order") is a rewrite nobody asked for.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BLOCKING_REFERENCE_KINDS,
  findLinkUrlReferences,
  findRouteReferences,
  reexportsInto,
  removeReexports,
  renameInComments,
  renameInScreenFile,
  renameRouteReferences,
} from '../dist/index.js';

const APP = path.resolve('/app');
const target = { routeName: 'Order', folder: path.join(APP, 'src/screens/OrderScreen'), componentName: 'OrderScreen' };
const renameTo = { ...target, to: 'Invoice', toFolder: path.join(APP, 'src/screens/InvoiceScreen'), toComponent: 'InvoiceScreen' };
const HOME = path.join(APP, 'src/screens/HomeScreen/index.tsx');

const SOURCE = `import React from 'react';
import { Link, CommonActions } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import OrderRow from '../OrderScreen/components/OrderRow';
import Lazy from '@/screens/OrderScreen';

type Props = NativeStackScreenProps<RootStackParamList, 'Order'>;

export default function HomeScreen({ navigation }: Props) {
  navigation.navigate('Order', { id: 1 });
  navigation.push("Order");
  navigation.navigate('Tabs', { screen: 'Order' });
  navigation.dispatch(CommonActions.reset({ index: 0, routes: [{ name: 'Order' }] }));
  const title = 'Order';
  return <Link screen="Order">{title}</Link>;
}
`;

describe('findRouteReferences', () => {
  it('classifies each way an app names a route', () => {
    const references = findRouteReferences(SOURCE, HOME, target);
    expect(references.map((reference) => reference.kind)).toEqual([
      'import', 'import', 'type', 'navigate', 'navigate', 'screen-param', 'screen-param', 'mention', 'screen-param',
    ]);
    expect(references[3]).toMatchObject({ line: 10, text: "navigation.navigate('Order', { id: 1 });" });
  });

  it('recognises initial routes and screen registrations', () => {
    const navigator = '<Stack.Navigator initialRouteName="Order"><Stack.Screen name="Order" component={OrderScreen} /></Stack.Navigator>;\nconst linking = { config: { initialRouteName: \'Order\' } };\n';
    expect(findRouteReferences(navigator, path.join(APP, 'src/Nav.tsx'), target).map((reference) => reference.kind)).toEqual([
      'initial-route', 'screen', 'initial-route',
    ]);
  });

  it('treats a plain mention as something to report, not something that breaks', () => {
    expect(BLOCKING_REFERENCE_KINDS.has('mention')).toBe(false);
    expect(BLOCKING_REFERENCE_KINDS.has('navigate')).toBe(true);
  });
});

describe('renameRouteReferences', () => {
  it('rewrites every classified reference and leaves mentions alone', () => {
    const { result, unhandled } = renameRouteReferences(SOURCE, HOME, renameTo);

    expect(result.changed).toBe(true);
    for (const expected of [
      "NativeStackScreenProps<RootStackParamList, 'Invoice'>",
      "navigation.navigate('Invoice', { id: 1 })",
      'navigation.push("Invoice")',
      "{ screen: 'Invoice' }",
      "{ name: 'Invoice' }",
      '<Link screen="Invoice">',
      "from '../InvoiceScreen/components/OrderRow'",
      "from '@/screens/InvoiceScreen'",
      "const title = 'Order';",
    ]) {
      expect(result.content).toContain(expected);
    }
    expect(unhandled.map((reference) => reference.text)).toEqual(["const title = 'Order';"]);
  });

  it('leaves relative imports alone inside the folder that moves', () => {
    const inside = path.join(APP, 'src/screens/OrderScreen/index.tsx');
    const source = "import Row from './components/OrderRow';\n";
    expect(renameRouteReferences(source, inside, renameTo).result).toMatchObject({ changed: false, content: source });
  });
});

describe('what is and is not navigation', () => {
  it('leaves push, replace and reset on other objects, and other generics, as mentions', () => {
    const source = `export type Status = 'Order' | 'Cart';
export type NotOrder = Exclude<Status, 'Order'>;
export type Picked = Pick<Record<Status, number>, 'Order'>;
export function f(text: string, tags: string[], form: { reset(v: object): void }, router: { push(p: string): void }) {
  tags.push('Order');
  form.reset({ name: 'Order' });
  router.push('Order');
  return text.replace('Order', 'x');
}
`;
    expect(findRouteReferences(source, HOME, target).map((reference) => reference.kind)).toEqual(Array(7).fill('mention'));
    expect(renameRouteReferences(source, HOME, renameTo).result).toMatchObject({ changed: false, content: source });
  });

  it('recognises navigation however it is reached', () => {
    const source = `export function g(props, navigationRef) {
  const { navigate } = useNavigation();
  navigate('Order');
  props.navigation.push('Order');
  navigationRef.current?.navigate('Order');
  useNavigation().replace('Order');
  StackActions.replace('Order');
  props.navigation.navigate(signedIn ? 'Home' : 'Order');
  props.navigation.replace(('Order' as const));
  props.navigation.navigate(next ?? 'Order');
  props.navigation.navigate({ name: flag ? 'Order' : 'Home' });
  type R = RouteProp<RootStackParamList, 'Order'>;
}
`;
    expect(findRouteReferences(source, HOME, target).map((reference) => reference.kind)).toEqual([
      'navigate', 'navigate', 'navigate', 'navigate', 'navigate', 'navigate', 'navigate', 'navigate', 'screen-param', 'type',
    ]);
    const { result } = renameRouteReferences(source, HOME, renameTo);
    expect(result.content).toContain("signedIn ? 'Home' : 'Invoice'");
    expect(result.content).toContain("next ?? 'Invoice'");
  });

  it('renames names inside comments', () => {
    expect(renameInComments(
      "/** navigation.navigate('Order') renders <OrderScreen /> */\nconst label = 'Order';\n",
      HOME,
      { from: 'Order', to: 'Invoice', fromComponent: 'OrderScreen', toComponent: 'InvoiceScreen' },
    )).toBe("/** navigation.navigate('Invoice') renders <InvoiceScreen /> */\nconst label = 'Order';\n");
  });

  it('renames named imports of the component with their uses, and keeps re-exported names', () => {
    const source = "import { OrderScreen } from '../OrderScreen';\nimport { OrderScreen as Screen } from '../OrderScreen';\nexport { OrderScreen as Legacy } from '../OrderScreen';\nexport { OrderScreen } from '../OrderScreen';\n\nexport const screens = [OrderScreen, Screen];\n";
    const { result } = renameRouteReferences(source, HOME, renameTo);
    expect(result.content).toBe(
      "import { InvoiceScreen } from '../InvoiceScreen';\nimport { InvoiceScreen as Screen } from '../InvoiceScreen';\nexport { InvoiceScreen as Legacy } from '../InvoiceScreen';\nexport { InvoiceScreen as OrderScreen } from '../InvoiceScreen';\n\nexport const screens = [InvoiceScreen, Screen];\n",
    );
  });
});

describe('findLinkUrlReferences', () => {
  it('finds strings that open the deep link by URL, and not paths that only contain it', () => {
    const source = [
      'export function h(id: string) {',
      "  linkTo('/order');",
      "  Linking.openURL('myapp://order/42');",
      '  linkTo(`/order/${id}`);',
      "  Linking.openURL('https://myapp.com/order?ref=mail');",
      "  linkTo('/orders');",
      "  sortBy('order');",
      "  fetch('/api/order');",
      "  const icon = require('./assets/order/icon.png');",
      "  fetch('https://api.example.com/v1/order');",
      "  linkTo('/Order');",
      '  return <Link href="/order">Orders</Link>;',
      '}',
      '',
    ].join('\n');
    expect(findLinkUrlReferences(source, HOME, 'order/:id').map((reference) => reference.line)).toEqual([2, 3, 4, 5, 12]);
    expect(findLinkUrlReferences(source, HOME, ':id')).toEqual([]);
  });
});

describe('barrel re-exports', () => {
  it('reads and removes the names a barrel re-exports from the folder', () => {
    const barrel = path.join(APP, 'src/screens/index.ts');
    const source = "export { default as HomeScreen } from './HomeScreen';\nexport { default as OrderScreen } from './OrderScreen';\nexport { default as OrderRow, OrderTotals } from './OrderScreen/components';\n";

    expect(reexportsInto(source, barrel, target)).toEqual(['OrderScreen', 'OrderRow', 'OrderTotals']);
    expect(removeReexports(source, barrel, target, ['OrderScreen', 'OrderTotals']).content).toBe(
      "export { default as HomeScreen } from './HomeScreen';\nexport { default as OrderRow } from './OrderScreen/components';\n",
    );
    expect(reexportsInto("export * from './OrderScreen';\n", barrel, target)).toBeNull();
  });
});

describe('renameInScreenFile', () => {
  it('renames the component and the names in its doc comment', () => {
    const index = `import React from 'react';

/**
 * OrderScreen
 *
 * Reach it from anywhere with:
 *   navigation.navigate('Order');
 */
export default function OrderScreen() {
  return <Text>Order</Text>;
}
`;
    const renamed = renameInScreenFile(index, target.folder + '/index.tsx', { from: 'Order', to: 'Invoice', fromComponent: 'OrderScreen', toComponent: 'InvoiceScreen' });
    expect(renamed).toContain(' * InvoiceScreen\n');
    expect(renamed).toContain("navigation.navigate('Invoice');");
    expect(renamed).toContain('export default function InvoiceScreen()');
    expect(renamed).toContain('<Text>Invoice</Text>');
  });
});
