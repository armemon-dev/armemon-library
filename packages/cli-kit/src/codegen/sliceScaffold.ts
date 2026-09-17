/**
 * FILE: sliceScaffold.ts
 * PATH: packages/cli-kit/src/codegen/sliceScaffold.ts
 *
 * WHAT: What a Redux slice is called, and the file `armemon create-slice` writes.
 * WHY:  A slice name becomes four different things — a file name, an exported
 *       binding, the key in `slices: {}`, and the prefix on every action type — and
 *       they have to agree or the store silently holds state under a name nothing
 *       reads. So the name is normalised once, here, the way normalizeScreenName
 *       does it for screens.
 *
 *       It lives in cli-kit rather than plugin-redux because the CLI command needs
 *       it, and a command must not import from a plugin package: the plugin may not
 *       even be installed in the app being edited.
 * HOW:  Plain-object slice form — { name, initialState, reducers } — which the Redux
 *       plugin passes to createSlice. It is the shape with the least to explain, and
 *       the generated file says how to move to the full createSlice form when async
 *       work arrives.
 * WHEN: `armemon create-slice`, and anywhere a slice's name has to be derived.
 *
 * EXPORTS: SLICE_NAME_PATTERN, validateSliceName, SliceName, normalizeSliceName,
 *          buildSliceFile
 * DEPENDS ON: @armemon-library/config-types
 * USED BY: packages/cli-armemon/src/flows/createSlice.ts
 */

import { SLICES_DIR, type AppLanguage } from '@armemon-library/config-types';

/**
 * The state key is written as `state.cart` and as the action prefix `cart/add`, so
 * it has to be a plain identifier starting lowercase.
 */
export const SLICE_NAME_PATTERN = /^[a-z][A-Za-z0-9]*$/;

export function validateSliceName(value: string): string | undefined {
  if (!SLICE_NAME_PATTERN.test(value)) {
    return 'Start with a lowercase letter and use letters and numbers only, e.g. cart or userProfile.';
  }
  return undefined;
}

export interface SliceName {
  /** The key in `slices: {}` and in state: `cart`. */
  stateKey: string;
  /** The exported binding and the file stem: `cartSlice`. */
  exportName: string;
  /** App-relative, with the app's own extension: `src/store/slices/cartSlice.ts`. */
  file: string;
}

/**
 * Anything someone might reasonably type, reduced to one answer.
 *
 * `Cart`, `cart`, `cartSlice`, `CartSlice`, `cart-items` and a full path to the file
 * all name the same slice — the same tolerance create-screen has, for the same
 * reason: the name gets typed at a prompt, in a flag, and from shell completion.
 */
export function normalizeSliceName(input: string, language: AppLanguage = 'typescript'): SliceName {
  let value = input.trim().replace(/^["']|["']$/g, '');

  value = value.replace(/^(?:\.\/)?(?:src\/)?(?:store\/)?slices\//, '');
  value = value.replace(/\.[jt]sx?$/, '');
  value = value.split('/').filter(Boolean).pop() ?? '';

  // cart-items / cart_items / "cart items" all become cartItems.
  const parts = value.split(/[-_ .]+/).filter(Boolean);
  const camel = parts
    .map((part, index) =>
      index === 0
        ? `${part.charAt(0).toLowerCase()}${part.slice(1)}`
        : `${part.charAt(0).toUpperCase()}${part.slice(1)}`,
    )
    .join('');

  // Only a capitalised `Slice` suffix is dropped, and a bare "slice" is rejected
  // outright. Stripping case-insensitively would turn a slice legitimately named
  // `splice` into `sp`.
  const stateKey = /^[Ss]lice$/.test(camel) ? '' : camel.replace(/Slice$/, '');
  if (stateKey.length === 0) {
    throw new Error('"Slice" is not a name on its own — try cart or cartSlice.');
  }

  const problem = validateSliceName(stateKey);
  if (problem) throw new Error(problem);

  const extension = language === 'javascript' ? 'js' : 'ts';
  return {
    stateKey,
    exportName: `${stateKey}Slice`,
    file: `${SLICES_DIR}/${stateKey}Slice.${extension}`,
  };
}

export interface BuildSliceOptions {
  name: SliceName;
  /** App-relative path of the store config, for the header and the wiring note. */
  storeConfigPath: string;
}

/**
 * The slice file itself — yours from the moment it is written.
 *
 * Written in the app's own language, decided by the extension `normalizeSliceName`
 * gave it. The central TypeScript-to-JavaScript conversion only touches .ts/.tsx
 * paths, so a .js file built from TypeScript text reaches the app with its types
 * still in it.
 */
export function buildSliceFile(options: BuildSliceOptions): { path: string; content: string } {
  const { name, storeConfigPath } = options;
  const { stateKey, exportName } = name;
  const typed = !name.file.endsWith('.js');
  const fileName = name.file.split('/').pop()!;

  const content = `/**
 * FILE: ${fileName}
 * PATH: ${name.file}
 *
 * WHAT: The ${stateKey} slice — its state and the reducers that change it.
 * WHY:  Written once by \`armemon create-slice ${stateKey}\` and never read again:
 *       this is your domain state, so it lives in your zone. ${storeConfigPath}
 *       imports it and that is the whole of armemon's involvement.
 * HOW:  The plain-object form, which armemon passes to createSlice for you. Reducers
 *       run through Immer, so mutating \`state\` is correct here.
 * WHEN: Loaded by ${storeConfigPath}.
 *
 * EXPORTS: ${exportName}
 * DEPENDS ON: nothing
 * USED BY: ${storeConfigPath}
 */

export const ${exportName} = {
  name: '${stateKey}',

  initialState: {
    // Whatever this slice owns. Keep it to what you cannot compute:
    // derived values belong in a selector, not in state.
    value: ${typed ? 'null as unknown' : 'null'},
  },

  reducers: {
    set: (${typed ? 'state: { value: unknown }, action: { payload: unknown }' : 'state, action'}) => {
      state.value = action.payload;
    },

    clear: (${typed ? 'state: { value: unknown }' : 'state'}) => {
      state.value = null;
    },
  },
};

/**
 * USING IT
 *
 *   import { useSelector, useDispatch } from '@armemon-library/redux';
 *
 *   const ${stateKey} = useSelector((${typed ? 'state: any' : 'state'}) => state.${stateKey}.value);
 *   const dispatch = useDispatch();
 *   dispatch({ type: '${stateKey}/set', payload: 'anything' });
 *
 * The action type is \`${stateKey}/<reducer>\` — the slice name above is that prefix,
 * which is why renaming it by hand breaks every dispatch. \`armemon rename-slice\`
 * changes the name, the file, the import and the store entry together.
 *
 * WHEN YOU NEED ASYNC
 *
 * Switch to calling createSlice yourself and export the result — the store config
 * accepts either form, and detects this one by its \`.reducer\`:
 *
 *   import { createSlice, createAsyncThunk } from '@armemon-library/redux';
 *
 *   export const load${exportName.charAt(0).toUpperCase()}${exportName.slice(1)} =
 *     createAsyncThunk('${stateKey}/load', async () => {
 *       const response = await fetch('https://example.com/${stateKey}');
 *       return response.json();
 *     });
 *
 *   export const ${exportName} = createSlice({
 *     name: '${stateKey}',
 *     initialState: { value: null, status: 'idle' },
 *     reducers: {},
 *     extraReducers: (builder) => {
 *       builder
 *         .addCase(load${exportName.charAt(0).toUpperCase()}${exportName.slice(1)}.pending, (state) => {
 *           state.status = 'loading';
 *         })
 *         .addCase(load${exportName.charAt(0).toUpperCase()}${exportName.slice(1)}.fulfilled, (state, action) => {
 *           state.status = 'idle';
 *           state.value = action.payload;
 *         });
 *     },
 *   });
 */
`;

  return { path: name.file, content };
}
