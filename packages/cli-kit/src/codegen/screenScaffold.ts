/**
 * FILE: screenScaffold.ts
 * PATH: packages/cli-kit/src/codegen/screenScaffold.ts
 *
 * WHAT: Where a screen lives, what its name is, and what files make it up.
 * WHY:  Two callers create screens — the navigation wizard at init, and
 *       `armemon create-screen` afterwards — and they must produce the same shape.
 *       Split across two packages, they would drift the first time either changed.
 *
 *       The folder layout is the point of the whole thing: a screen is a folder, not
 *       a file, so it has somewhere to put its own components, hooks, utils and
 *       assets when it grows. Empty folders can't be committed, so each holds a
 *       README that says what belongs in it — which is also where the guidance lives.
 * HOW:  All doc text is built for the app's language rather than relying on the
 *       TypeScript-to-JavaScript conversion to rewrite it afterwards: that rewrite
 *       only sees files from the same plan, and these are written by the init flow.
 * WHEN: `buildScreenFiles` at init and on create-screen; `normalizeScreenName` on
 *       whatever the user typed on the command line.
 *
 * EXPORTS: SCREEN_NAME_PATTERN, validateScreenName, LINKING_PATH_PATTERN,
 *          validateLinkingPath, RouteParam, RouteParamType, parseRouteParams,
 *          linkingPathParams, mergeRouteParams, paramListEntryType, linkingParsersFor,
 *          exampleParams, navigateExample, normalizeScreenName, screenPathFor, buildScreenFiles,
 *          ScreenName, ScreenShape, ScreenKind, ScreenTyping
 * DEPENDS ON: @armemon-library/config-types
 * USED BY: packages/plugin-navigation/src/wizard, packages/cli-armemon/src/flows
 */

import {
  DEFAULT_LAYOUT,
  EXAMPLES_DIR,
  SCREENS_DIR,
  SHARED_DIR,
  managedPath,
  type AppLanguage,
  type AppLayout,
  type PluginInstallPlan,
} from '@armemon-library/config-types';

/**
 * A route name becomes a component name, a folder name, an import identifier and a
 * param-list key. Free text here produced `export default function my homeScreen()`.
 */
export const SCREEN_NAME_PATTERN = /^[A-Z][A-Za-z0-9]*$/;

export function validateScreenName(value: string): string | undefined {
  if (!SCREEN_NAME_PATTERN.test(value)) {
    return 'Start with a capital letter and use letters and numbers only, e.g. Home or Profile2.';
  }
  if (value.endsWith('Screen')) {
    return 'Leave off the "Screen" suffix — armemon appends it to the generated file and component.';
  }
  return undefined;
}

/**
 * A deep-link path is written into navigation.config between single quotes and then
 * matched against incoming URLs, so anything outside this set either breaks the file
 * or never matches. Applies to --link as much as the prompt — a flag is typed too.
 * Uppercase is allowed because React Navigation matches case-sensitively: `Tyt` and
 * `tyt` are both real, different paths. `:id` and `:id?` segments are route params.
 */
export const LINKING_PATH_PATTERN =
  /^(?:[A-Za-z0-9][A-Za-z0-9_-]*|:[A-Za-z_]\w*\??)(?:\/(?:[A-Za-z0-9_-]+|:[A-Za-z_]\w*\??))*$/;

export function validateLinkingPath(value: string): string | undefined {
  return LINKING_PATH_PATTERN.test(value)
    ? undefined
    : 'Letters, numbers, dashes, underscores and slashes, starting with a letter or number; params look like :id or :id?.';
}

export type RouteParamType = 'string' | 'number' | 'boolean';

export interface RouteParam {
  name: string;
  type: RouteParamType;
  optional: boolean;
}

/** `id:string,page?:number,draft:boolean`. A bare name is a string. */
export function parseRouteParams(spec: string): RouteParam[] {
  const params: RouteParam[] = [];
  for (const part of spec.split(',').map((entry) => entry.trim()).filter(Boolean)) {
    const match = /^([A-Za-z_]\w*)(\?)?(?:\s*:\s*(string|number|boolean))?$/.exec(part);
    if (!match?.[1]) {
      throw new Error(`"${part}" isn't a param. Write name:type — e.g. id:string or page?:number (string, number or boolean).`);
    }
    if (params.some((param) => param.name === match[1])) throw new Error(`The param "${match[1]}" is listed twice.`);
    params.push({ name: match[1], optional: Boolean(match[2]), type: (match[3] as RouteParamType | undefined) ?? 'string' });
  }
  return params;
}

/** The params a deep-link path declares — `order/:id/:tab?`. URLs carry strings. */
export function linkingPathParams(linkPath: string): RouteParam[] {
  return [...linkPath.matchAll(/:([A-Za-z_]\w*)(\?)?/g)].map((match) => ({
    name: match[1]!,
    optional: Boolean(match[2]),
    type: 'string' as const,
  }));
}

/** Declared params win; a path param nobody declared is a string. */
export function mergeRouteParams(declared: RouteParam[], fromPath: RouteParam[]): RouteParam[] {
  const merged = [...declared];
  for (const param of fromPath) {
    if (!merged.some((entry) => entry.name === param.name)) merged.push(param);
  }
  return merged;
}

/** The route's entry in a param list: `undefined`, or `{ id: string; page?: number }`. */
export function paramListEntryType(params: RouteParam[]): string {
  if (params.length === 0) return 'undefined';
  return `{ ${params.map((param) => `${param.name}${param.optional ? '?' : ''}: ${param.type}`).join('; ')} }`;
}

/**
 * React Navigation hands path and query params over as strings; these turn the
 * others back into what the param list promises.
 */
export function linkingParsersFor(params: RouteParam[], language: AppLanguage): Record<string, string> | undefined {
  const parsers: Record<string, string> = {};
  for (const param of params) {
    if (param.type === 'number') parsers[param.name] = 'Number';
    if (param.type === 'boolean') {
      parsers[param.name] = language === 'javascript' ? "(value) => value === 'true'" : "(value: string) => value === 'true'";
    }
  }
  return Object.keys(parsers).length > 0 ? parsers : undefined;
}

/** Sample values for a navigate() call in generated docs: `{ id: 'abc', page: 1 }`. */
export function exampleParams(params: RouteParam[]): string {
  const sample = { string: "'abc'", number: '1', boolean: 'true' } as const;
  return `{ ${params.map((param) => `${param.name}: ${sample[param.type]}`).join(', ')} }`;
}

/**
 * The navigate() call that reaches a route from anywhere. A tab screen inside a stack's
 * "Tabs" route is `navigate('Tabs', { screen: 'Order' })` — a bare navigate('Order')
 * is a type error against the app's root param list.
 */
export function navigateExample(routeName: string, nesting: string[], params: RouteParam[]): string {
  let target = routeName;
  let argument = params.length > 0 ? exampleParams(params) : null;
  for (const parent of [...nesting].reverse()) {
    argument = `{ screen: '${target}'${argument ? `, params: ${argument}` : ''} }`;
    target = parent;
  }
  return `navigation.navigate('${target}'${argument ? `, ${argument}` : ''})`;
}

export interface ScreenName {
  /** The route: `Order`. What navigate() takes and the param list keys. */
  routeName: string;
  /** The component and folder: `OrderScreen`. */
  componentName: string;
  /** App-relative folder: `src/screens/OrderScreen`. See SCREENS_DIR. */
  folder: string;
  /** The deep-link path, as the name was typed: `tytScreen` → `tyt`, `TytScreen` → `Tyt`. */
  linkingPath: string;
}

/** Anything a person might reasonably type for a screen, reduced to one answer. */
export function normalizeScreenName(input: string): ScreenName {
  let value = input.trim().replace(/^["']|["']$/g, '');

  value = value.replace(/^(?:\.\/)?(?:src\/)?screens\//, '');
  value = value.replace(/\/index\.[jt]sx?$/, '');
  value = value.replace(/\.[jt]sx?$/, '');
  value = value.replace(/\/+$/, '');
  value = value.split('/').filter(Boolean).pop() ?? '';

  const componentBase = value
    .split(/[-_ .]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join('');

  const routeName = componentBase.replace(/Screen$/, '');

  if (routeName.length === 0) {
    throw new Error('"Screen" is not a route name on its own — try HomeScreen or Home.');
  }

  const problem = validateScreenName(routeName);
  if (problem) throw new Error(problem);

  // The component is always capitalised, but the URL keeps the name as it was typed —
  // case and dashes included — minus the same Screen suffix stripped above:
  // `tytScreen` → `tyt`, `TytScreen` → `Tyt`, `order-history` stays `order-history`.
  // Spaces and dots can't appear in a path, so they become dashes.
  const linkingPath = value
    .replace(/(?:[-_ .]+[sS]|S)creen$/, '')
    .replace(/[ .]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');

  return {
    routeName,
    componentName: `${routeName}Screen`,
    folder: `${SCREENS_DIR}/${routeName}Screen`,
    linkingPath,
  };
}

/** The one definition of where a screen's files go. */
export function screenPathFor(routeName: string, file = 'index.tsx'): string {
  return `${SCREENS_DIR}/${routeName}Screen/${file}`;
}

export type ScreenShape = 'full' | 'flat';
export type ScreenKind = 'blank' | 'placeholder' | 'reference' | 'welcome' | 'welcome-themed';

/** How a screen's props are typed when its navigator has a param list. */
export interface ScreenTyping {
  /** e.g. NativeStackScreenProps */
  propsType: string;
  /** e.g. @react-navigation/native-stack */
  propsPackage: string;
  /** e.g. RootStackParamList */
  paramListType: string;
  /** From the screen's index to the file declaring the param list. */
  paramListImport: string;
}

interface BuildScreenOptions {
  routeName: string;
  shape: ScreenShape;
  language: AppLanguage;
  kind: ScreenKind;
  /** Used by the welcome screens, which greet by name. */
  appName?: string;
  /** The blank screen reads these from its route. */
  params?: RouteParam[];
  /** With params, types them at the component instead of reading them untyped. */
  typing?: ScreenTyping;
  /** Routes the screen's navigator is nested under, for the navigate() example. */
  nesting?: string[];
  /** Where this app keeps its managed files, for the paths the guidance names. */
  layout?: AppLayout;
}

/**
 * Examples take the app's own extension. A README telling a JavaScript app to write
 * `formatOrderDate.ts` is wrong, and no other check would catch it: these files are
 * written outside any plugin plan, so the .ts-to-.js rewrite never sees them.
 */
function folderGuide(
  extension: string,
): Record<string, { what: string; when: string; example: string }> {
  return {
    components: {
      what: 'Components used only by this screen.',
      when: `Move one to ${SHARED_DIR}/components/ the moment a second screen needs it.`,
      example: 'OrderRow, OrderTotalBar',
    },
    hooks: {
      what: 'Hooks used only by this screen.',
      when: 'A hook that fetches or derives this screen’s data belongs here, not in the component.',
      example: 'useOrderTotals, useOrderFilters',
    },
    utils: {
      what: 'Pure functions used only by this screen.',
      when: 'Anything you can test without rendering. Keep the test beside it.',
      example: `formatOrderDate.${extension} + formatOrderDate.test.${extension}`,
    },
    assets: {
      what: 'Images and other files used only by this screen.',
      when: 'Shared artwork belongs in the app-level assets/ folder instead.',
      example: 'empty-state.png',
    },
  };
}

function folderReadme(folder: string, routeName: string, extension: string): string {
  const guide = folderGuide(extension)[folder];
  if (!guide) return `# ${folder}\n`;

  return `# ${routeName}Screen / ${folder}

${guide.what}

${guide.when}

For example: ${guide.example}

This file is a placeholder so the folder can be committed while it is empty — delete
it once there is something here, or delete the folder if this screen never needs one.
`;
}

function screenBody(options: BuildScreenOptions): string {
  const { routeName, kind, appName = 'your app' } = options;
  const component = `${routeName}Screen`;
  const layout = options.layout ?? DEFAULT_LAYOUT;
  // Extensionless on purpose: these are prose naming a file, and a JavaScript app
  // must never be pointed at a .ts/.tsx path it doesn't have.
  const rootNavigatorFile = managedPath(layout, 'navigation/RootNavigator');
  const themeConfigFile = managedPath(layout, 'ui/theme.config');

  if (kind === 'welcome-themed') {
    return `import React from 'react';
import { Container, Text, Button } from '@armemon-library/ui';

/**
 * The app's root component, and a live check that your theme is working: every
 * colour and size here comes from ${themeConfigFile}.
 *
 * Replace it with your real first screen — nothing regenerates this file.
 *
 * Every component, prop and hook the UI plugin ships is written out in
 * ${EXAMPLES_DIR}/UiKitScreen, which nothing imports. Read it, copy what you
 * need, delete the folder.
 */
export default function ${component}() {
  return (
    <Container style={{ padding: 24, gap: 12 }}>
      <Text level="xlarge">${appName}</Text>
      <Text muted>Built with armemon. Edit ${SCREENS_DIR}/${component}/index to change this.</Text>
      <Button label="Nothing here yet" onPress={() => {}} />
    </Container>
  );
}
`;
  }

  if (kind === 'welcome') {
    return `import React from 'react';
import { View, Text } from 'react-native';

/**
 * The app's root component. Replace it with your real first screen — nothing
 * regenerates this file.
 *
 * WHERE THINGS ARE
 *   ${`${layout.managed}/`.padEnd(21)}armemon's own files; commands write and re-edit these
 *   ${`${SCREENS_DIR}/`.padEnd(21)}your screens, one folder each
 *   ${`${SHARED_DIR}/`.padEnd(21)}code more than one screen uses
 *   ${`${EXAMPLES_DIR}/`.padEnd(21)}armemon's stock parts, safe to replace or delete
 *
 * To add a screen: armemon create-screen Order
 */
export default function ${component}() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>Welcome to ${appName} — built with armemon.</Text>
    </View>
  );
}
`;
  }

  if (kind === 'reference') {
    const indexFile = `index.${options.language === 'javascript' ? 'jsx' : 'tsx'}`;
    return `import React from 'react';
import { View, Text } from 'react-native';

/**
 * The shape every screen in this app can take. Nothing imports this file — it is
 * here to be read and copied, and it is safe to delete.
 *
 * A screen is a FOLDER, not a file, so it has somewhere to put its own parts as it
 * grows:
 *
 *   ${SCREENS_DIR}/${component}/
 *   ├── ${indexFile}        the screen itself — this file
 *   ├── components/      pieces only this screen renders
 *   ├── hooks/           state and data loading only this screen needs
 *   ├── utils/           pure helpers, with their tests beside them
 *   └── assets/          images only this screen uses
 *
 * Each of those folders has a README explaining what belongs in it. Start with just
 * index; add a folder when you actually have something to put in it.
 *
 * The rule that keeps this tidy: the moment a SECOND screen needs something, move it
 * to ${SHARED_DIR}/. One screen's detail stays here; everything shared goes there.
 *
 * You do not have to create screens by hand:
 *
 *   armemon create-screen Order
 *
 * makes this whole folder, registers the route in your navigator and param list, and
 * adds a deep-link path if you have linking turned on.
 */
export default function ${component}() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>${component}</Text>
    </View>
  );
}
`;
  }

  if (kind === 'placeholder') {
    return `import React from 'react';
import { View, Text } from 'react-native';

/**
 * A starting point armemon generated for the "${routeName}" route. Rename it, rewrite
 * it, or delete it and remove its line from ${rootNavigatorFile} —
 * or let armemon do both: armemon remove-screen ${routeName}.
 *
 * See ${SCREENS_DIR}/ExampleScreen for the folder shape a screen can grow into.
 */
export default function ${component}() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>${routeName}</Text>
    </View>
  );
}
`;
  }

  const params = options.params ?? [];
  const doc = `/**
 * ${component}
 *
 * Reach it from anywhere with:
 *   const navigation = useNavigation();
 *   ${navigateExample(routeName, options.nesting ?? [], params)};
 */`;

  if (params.length === 0) {
    return `import React from 'react';
import { View, Text } from 'react-native';

${doc}
export default function ${component}() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>${routeName}</Text>
    </View>
  );
}
`;
  }

  // A typed navigator types the params at the component. Without one, useRoute()
  // reads them untyped rather than claiming a shape nothing checks.
  const { typing } = options;
  if (typing) {
    return `import React from 'react';
import { View, Text } from 'react-native';
import type { ${typing.propsType} } from '${typing.propsPackage}';
import type { ${typing.paramListType} } from '${typing.paramListImport}';

type Props = ${typing.propsType}<${typing.paramListType}, '${routeName}'>;

${doc}
export default function ${component}({ route }: Props) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>${routeName}</Text>
      <Text>{JSON.stringify(route.params)}</Text>
    </View>
  );
}
`;
  }

  return `import React from 'react';
import { View, Text } from 'react-native';
import { useRoute } from '@react-navigation/native';

${doc}
export default function ${component}() {
  const route = useRoute();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>${routeName}</Text>
      <Text>{JSON.stringify(route.params)}</Text>
    </View>
  );
}
`;
}

/**
 * Every file a screen is made of.
 *
 * Paths carry the app's real extension rather than being converted afterwards: the
 * language conversion only rewrites names it can see in the same batch, and these are
 * written outside any plugin's plan.
 */
export function buildScreenFiles(options: BuildScreenOptions): PluginInstallPlan['filesToWrite'] {
  const { routeName, shape, language } = options;
  const extension = language === 'javascript' ? 'jsx' : 'tsx';

  const files: PluginInstallPlan['filesToWrite'] = [
    { path: screenPathFor(routeName, `index.${extension}`), content: screenBody(options) },
  ];

  if (shape === 'full') {
    for (const folder of ['components', 'hooks', 'utils', 'assets']) {
      files.push({
        path: screenPathFor(routeName, `${folder}/README.md`),
        content: folderReadme(folder, routeName, language === 'javascript' ? 'js' : 'ts'),
      });
    }
  }

  return files;
}
