/**
 * FILE: linkingRoutes.test.ts
 * PATH: packages/cli-kit/test/linkingRoutes.test.ts
 *
 * WHAT: Reading every deep link a navigation.config declares.
 * WHY:  `armemon link list` exists to answer "where does this URL actually go", and
 *       the answer is wrong without the nesting: React Navigation resolves a FLAT
 *       entry for a tab screen to a root route the root stack doesn't have, so the
 *       link opens nothing. A lister that flattened the tree would show that broken
 *       config as healthy — which is the bug nestLinkingRoutes exists to fix, made
 *       invisible.
 * HOW:  Against the shape the navigation wizard generates, including the object form
 *       an entry takes once it has parsers.
 */
import { describe, expect, it } from 'vitest';
import { linkingRoutes } from '../dist/index.js';

const FLAT = `export const linking = {
  prefixes: ['myapp://'],
  config: {
    screens: {
      Home: 'Home',
      Order: 'order/:id',
    },
  },
};
`;

const NESTED = `export const linking = {
  prefixes: ['myapp://'],
  config: {
    screens: {
      Tabs: {
        screens: {
          Home: 'home',
          Feed: 'feed',
        },
      },
      Details: 'details/:id',
    },
  },
};
`;

const WITH_PARSERS = `export const linking = {
  config: {
    screens: {
      Order: { path: 'order/:id', parse: { id: Number } },
    },
  },
};
`;

describe('linkingRoutes', () => {
  it('reads a flat config in the order it is written', () => {
    expect(linkingRoutes(FLAT)).toEqual([
      { routeName: 'Home', path: 'Home', nesting: [] },
      { routeName: 'Order', path: 'order/:id', nesting: [] },
    ]);
  });

  /** The case the whole thing exists for. */
  it('reports where a nested entry actually sits', () => {
    const routes = linkingRoutes(NESTED);

    expect(routes).toContainEqual({ routeName: 'Home', path: 'home', nesting: ['Tabs'] });
    expect(routes).toContainEqual({ routeName: 'Feed', path: 'feed', nesting: ['Tabs'] });
    // A sibling of the navigator, not inside it.
    expect(routes).toContainEqual({ routeName: 'Details', path: 'details/:id', nesting: [] });
  });

  it('reports a container that only nests others as having no path of its own', () => {
    expect(linkingRoutes(NESTED)).toContainEqual({ routeName: 'Tabs', path: null, nesting: [] });
  });

  it('reads the path out of the object form an entry takes once it has parsers', () => {
    expect(linkingRoutes(WITH_PARSERS)).toEqual([
      { routeName: 'Order', path: 'order/:id', nesting: [] },
    ]);
  });

  it('does not count a commented-out entry', () => {
    const commented = FLAT.replace("      Order: 'order/:id',", "      // Order: 'order/:id',");
    expect(linkingRoutes(commented).map((route) => route.routeName)).toEqual(['Home']);
  });

  it('returns nothing for a config with no screens rather than throwing', () => {
    expect(linkingRoutes("export const linking = { prefixes: ['myapp://'] };\n")).toEqual([]);
  });

  it('returns nothing for a file that does not parse', () => {
    expect(linkingRoutes('export const linking = {{{\n')).toEqual([]);
  });
});
