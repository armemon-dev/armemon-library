/**
 * FILE: storeConfig.test.ts
 * PATH: packages/cli-kit/test/storeConfig.test.ts
 *
 * WHAT: Naming a Redux slice, writing its file, and registering it in store.config.
 * WHY:  Registering a slice is two edits in one file — the import and the entry in
 *       `slices` — and doing one without the other produces an app that compiles and
 *       whose state is quietly missing. That is the failure these cover.
 *
 *       The fixture keeps the generated file's commented-out example
 *       (`//   cart: cartSlice,`) on purpose: it is character-for-character what a
 *       real entry looks like, so a line-matching patcher would report "cart is
 *       already registered" and write nothing. Being parser-backed is the whole
 *       point, and this is the case that proves it.
 */
import { describe, expect, it } from 'vitest';
import {
  addSliceToStore,
  buildSliceFile,
  namedImportInsertion,
  normalizeSliceName,
  parseSource,
  removeSliceFromStore,
  renameSliceDeclaration,
  renameSliceImport,
  renameSliceInStore,
  storeSlices,
  validateSliceName,
  applyEdits,
} from '../dist/index.js';

/** The shape the Redux wizard actually generates, trimmed to what matters here. */
const STORE = `import type { ReduxConfig } from '@armemon-library/redux';
import { counterSlice } from '../../src/store/slices/counterSlice';

export const reduxConfig: ReduxConfig = {
  // armemon create-slice Cart writes the slice and adds both lines below for you.
  // By hand: create the file, import it above, add a line here.
  //   import { cartSlice } from '../../src/store/slices/cartSlice';
  //   cart: cartSlice,
  slices: {
    counter: counterSlice,
  },

  persist: { enabled: false },
};
`;

const add = (content: string, stateKey: string) =>
  addSliceToStore(content, {
    stateKey,
    exportName: `${stateKey}Slice`,
    from: `../../src/store/slices/${stateKey}Slice`,
  });

describe('storeSlices', () => {
  it('reads each registered slice with the import it came from', () => {
    expect(storeSlices(STORE)).toEqual([
      {
        stateKey: 'counter',
        binding: 'counterSlice',
        module: '../../src/store/slices/counterSlice',
      },
    ]);
  });

  it('does not count the commented-out example as a registered slice', () => {
    expect(storeSlices(STORE).map((slice) => slice.stateKey)).not.toContain('cart');
  });
});

describe('addSliceToStore', () => {
  it('adds both the import and the entry', () => {
    const { content, changed } = add(STORE, 'cart');

    expect(changed).toBe(true);
    expect(content).toContain("import { cartSlice } from '../../src/store/slices/cartSlice';");
    expect(content).toContain('cart: cartSlice,');
    expect(storeSlices(content).map((slice) => slice.stateKey)).toEqual(['counter', 'cart']);
  });

  it('is not fooled by the commented-out example of the same name', () => {
    // The comment says `cart: cartSlice,` — if that counted, this would report
    // "already registered" and the store would never get the real entry.
    const { changed, already } = add(STORE, 'cart');
    expect(changed).toBe(true);
    expect(already).toBeUndefined();
  });

  it('reports a re-run as already done rather than adding it twice', () => {
    const once = add(STORE, 'cart').content;
    const twice = add(once, 'cart');

    expect(twice.changed).toBe(false);
    expect(twice.already).toBe(true);
    expect(twice.content).toBe(once);
  });

  it('keeps the existing entries untouched', () => {
    expect(add(STORE, 'cart').content).toContain('counter: counterSlice,');
  });

  it('refuses a file that does not parse, and says what to do by hand', () => {
    const result = add('export const reduxConfig = {{{\n', 'cart');

    expect(result.changed).toBe(false);
    expect(result.reason).toMatch(/doesn't parse/);
    expect(result.manual).toContain('cart: cartSlice');
  });

  it('refuses when there is no slices object to add to', () => {
    const result = add('export const reduxConfig = { persist: { enabled: false } };\n', 'cart');

    expect(result.changed).toBe(false);
    expect(result.reason).toMatch(/slices/);
  });
});

describe('removeSliceFromStore', () => {
  it('removes the entry and the import that served it', () => {
    const { content, changed } = removeSliceFromStore(STORE, { stateKey: 'counter' });

    expect(changed).toBe(true);
    expect(content).not.toContain('counter: counterSlice,');
    expect(content).not.toContain("import { counterSlice }");
  });

  it('reports a slice that was never registered rather than failing', () => {
    const result = removeSliceFromStore(STORE, { stateKey: 'nothing' });
    expect(result.changed).toBe(false);
    expect(result.already).toBe(true);
  });

  it('keeps an import another entry still uses', () => {
    const shared = STORE.replace('    counter: counterSlice,', '    counter: counterSlice,\n    mirror: counterSlice,');
    const { content } = removeSliceFromStore(shared, { stateKey: 'mirror' });

    expect(content).toContain("import { counterSlice }");
    expect(content).toContain('counter: counterSlice,');
  });
});

describe('renameSliceInStore', () => {
  const rename = (content: string, from = 'counter', to = 'tally') =>
    renameSliceInStore(content, {
      from,
      to,
      fromExport: `${from}Slice`,
      toExport: `${to}Slice`,
      toModule: `../../src/store/slices/${to}Slice`,
    });

  it('renames the key, the binding and the import path together', () => {
    const { content, changed } = rename(STORE);

    expect(changed).toBe(true);
    expect(content).toContain("import { tallySlice } from '../../src/store/slices/tallySlice';");
    expect(content).toContain('tally: tallySlice,');
    expect(content).not.toContain('counter: counterSlice,');
  });

  /**
   * Without renameImportedName the rename would alias instead — to a name that stops
   * existing the moment the slice file's own export is renamed.
   */
  it('renames the imported name rather than aliasing it', () => {
    expect(rename(STORE).content).not.toContain('as tallySlice');
  });

  it('leaves the commented-out example alone', () => {
    expect(rename(STORE).content).toContain('//   cart: cartSlice,');
  });

  it('refuses when the new name is already registered', () => {
    const withBoth = add(STORE, 'tally').content;
    const result = rename(withBoth);

    expect(result.changed).toBe(false);
    expect(result.conflict).toBe(true);
    expect(result.reason).toMatch(/already registered/);
  });

  it('reports a slice that was never registered', () => {
    const result = rename(STORE, 'nothing', 'something');
    expect(result.changed).toBe(false);
    expect(result.already).toBe(true);
  });

  it('refuses a file that does not parse', () => {
    const result = rename('export const reduxConfig = {{{\n');
    expect(result.changed).toBe(false);
    expect(result.reason).toMatch(/doesn't parse/);
  });
});

describe('renameSliceDeclaration', () => {
  const SLICE = `/**
 * FILE: cartSlice.ts
 *
 * WHAT: The cart slice. Dispatch it with \`dispatch({ type: 'cart/set' })\`.
 */

export const cartSlice = {
  name: 'cart',
  initialState: { value: null },
  reducers: {
    set: (state, action) => {
      state.value = action.payload;
    },
  },
};
`;

  const rename = (content: string) =>
    renameSliceDeclaration(content, {
      fromExport: 'cartSlice',
      toExport: 'basketSlice',
      from: 'cart',
      to: 'basket',
    });

  it('renames the exported binding', () => {
    expect(rename(SLICE).content).toContain('export const basketSlice = {');
  });

  /**
   * The field Redux Toolkit builds every action type from. Renaming the binding and
   * leaving this would move state.cart to state.basket while the actions stayed
   * `cart/…` — half-renamed, silently.
   */
  it('renames the name field, which is the action-type prefix', () => {
    expect(rename(SLICE).content).toContain("name: 'basket',");
    expect(rename(SLICE).content).not.toContain("name: 'cart',");
  });

  it('follows the rename into the comments that describe it', () => {
    const { content } = rename(SLICE);
    expect(content).toContain('FILE: basketSlice.ts');
    expect(content).toContain("dispatch({ type: 'basket/set' })");
    expect(content).toContain('The basket slice');
  });

  it('works on the createSlice() form as well as the plain object', () => {
    const viaCall = SLICE.replace('export const cartSlice = {', 'export const cartSlice = createSlice({')
      .replace(/^};$/m, '});');
    expect(rename(viaCall).content).toContain("name: 'basket',");
  });

  it('refuses a file that does not parse', () => {
    const result = rename('export const cartSlice = {{{\n');
    expect(result.changed).toBe(false);
    expect(result.reason).toMatch(/doesn't parse/);
  });
});

describe('renameSliceImport', () => {
  const COMPONENT = `import { counterSlice } from '../../store/slices/counterSlice';

export function useCounter() {
  return counterSlice.name;
}
`;

  it('follows the rename through a file that imports the slice', () => {
    const { content, changed } = renameSliceImport(COMPONENT, {
      fileName: 'src/screens/HomeScreen/index.tsx',
      fromExport: 'counterSlice',
      toExport: 'tallySlice',
      toModule: '../../store/slices/tallySlice',
    });

    expect(changed).toBe(true);
    expect(content).toContain("import { tallySlice } from '../../store/slices/tallySlice';");
    expect(content).toContain('return tallySlice.name;');
  });

  it('changes nothing in a file that does not use the slice', () => {
    const other = "export const unrelated = 1;\n";
    const result = renameSliceImport(other, {
      fromExport: 'counterSlice',
      toExport: 'tallySlice',
      toModule: './x',
    });

    expect(result.changed).toBe(false);
    expect(result.content).toBe(other);
  });
});

describe('namedImportInsertion', () => {
  it('joins an existing import of the same module instead of opening a second', () => {
    const source = "import { a } from './x';\n";
    const file = parseSource(source, 'f.ts');
    const edit = namedImportInsertion(source, file, 'b', './x');

    expect(applyEdits(source, [edit!])).toBe("import { a, b } from './x';\n");
  });

  it('returns null when the name is already imported', () => {
    const source = "import { a } from './x';\n";
    expect(namedImportInsertion(source, parseSource(source, 'f.ts'), 'a', './x')).toBeNull();
  });
});

describe('normalizeSliceName', () => {
  it.each([
    ['cart', 'cart'],
    ['Cart', 'cart'],
    ['cartSlice', 'cart'],
    ['CartSlice', 'cart'],
    ['cart-items', 'cartItems'],
    ['src/store/slices/cartSlice.ts', 'cart'],
  ])('%s names the cart slice', (input, stateKey) => {
    expect(normalizeSliceName(input).stateKey).toBe(stateKey);
  });

  it('derives the export name and file from the state key', () => {
    expect(normalizeSliceName('cart')).toMatchObject({
      stateKey: 'cart',
      exportName: 'cartSlice',
      file: 'src/store/slices/cartSlice.ts',
    });
  });

  it('follows the app language into the file extension', () => {
    expect(normalizeSliceName('cart', 'javascript').file).toBe('src/store/slices/cartSlice.js');
  });

  it('refuses a name that is not a usable identifier', () => {
    expect(() => normalizeSliceName('Slice')).toThrow(/not a name on its own/);
    expect(validateSliceName('2cart')).toMatch(/lowercase letter/);
  });
});

describe('buildSliceFile', () => {
  it('names the store config it will be loaded by', () => {
    const { path: file, content } = buildSliceFile({
      name: normalizeSliceName('cart'),
      storeConfigPath: 'armemon/redux/store.config.ts',
    });

    expect(file).toBe('src/store/slices/cartSlice.ts');
    expect(content).toContain('armemon/redux/store.config.ts');
    expect(content).toContain('export const cartSlice = {');
    expect(content).toContain("name: 'cart',");
  });
});
