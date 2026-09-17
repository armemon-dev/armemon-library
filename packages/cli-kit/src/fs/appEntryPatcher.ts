/**
 * FILE: appEntryPatcher.ts
 * PATH: packages/cli-kit/src/fs/appEntryPatcher.ts
 *
 * WHAT: Rewrites the scaffolded app's App.tsx to import the generated runtime config
 *       and render a zero-prop <KitProvider> around the best root component the
 *       selection produced.
 * WHY:  This — together with runtimeConfigGenerator.ts — is the literal fulfillment
 *       of "no manual wiring left": the user never has to touch App.tsx themselves.
 *       The root is chosen by preference rather than a single boolean, because the
 *       UI plugin generates a themed ExampleScreen that used to be written and then
 *       imported by nothing at all — an orphan file demonstrating theme choices
 *       nobody could see. Navigation still wins when both exist (a navigator is a
 *       real app shell; an example screen is a demo).
 * HOW:  Overwrites App.tsx outright — the RN CLI's default template App.tsx is not
 *       worth preserving, and every scaffolded app's entry point is the same shape.
 * WHEN: Called once, near the end of the init flow, after runtime.generated.ts has
 *       been written.
 *
 *
 *       swapAppEntryRoot changes what an existing entry renders — the navigator or the
 *       welcome screen — for `armemon plugin add/remove navigation`, when the file has
 *       been edited and can't simply be written again.
 *
 * EXPORTS: patchAppEntry, buildAppEntrySource, appEntryFileName, swapAppEntryRoot,
 *          AppEntryPatchOptions, AppEntrySourceOptions, AppRootChoice
 * DEPENDS ON: node:path, node:fs/promises, typescript, @armemon-library/config-types,
 *             ./sourceEdit, ./patchResult
 * USED BY: packages/cli-armemon/src/flows/initReactNative.ts,
 *          packages/cli-armemon/src/flows/plugins/reconcile.ts
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import ts from 'typescript';
import { applyEdits, importStyleOf, parseSource, quoteString, samePathSpec, walk, type TextEdit } from './sourceEdit.js';
import { brokenReason, checked, done, refused, type PatchResult } from './patchResult.js';
import {
  DEFAULT_LAYOUT,
  EXAMPLES_DIR,
  SCREENS_DIR,
  SHARED_DIR,
  managedFile,
  managedPath,
  specifierFor,
  type AppLanguage,
  type AppLayout,
} from '@armemon-library/config-types';

export type AppRootChoice = 'navigation' | 'welcome';

export interface AppEntrySourceOptions {
  root: AppRootChoice;
  language?: AppLanguage;
  /** Where this app keeps its managed zone. Defaults to the current layout. */
  layout?: AppLayout;
}

export interface AppEntryPatchOptions extends AppEntrySourceOptions {
  appRoot: string;
}

/** The entry this file writes; every specifier below is computed relative to it. */
const APP_ENTRY = 'App.tsx';

/**
 * The two things an app can open on.
 *
 * There used to be a third, 'ui-example', which pointed at the UI plugin's component
 * catalogue. That catalogue now lives in the examples folder — one whose whole
 * identity is "delete this when you're done reading it" — and an app root you cannot
 * delete is a contradiction. The property it existed for (a new app shows the theme
 * rather than hiding it in an orphan file) is kept instead by rendering the welcome
 * screen itself themed when the UI plugin is present.
 */
function rootsFor(
  layout: AppLayout,
): Record<AppRootChoice, { importLine: string; element: string; name: string; specifier: string }> {
  const navigation = specifierFor(APP_ENTRY, managedFile.rootNavigator(layout));
  const welcome = specifierFor(APP_ENTRY, `${SCREENS_DIR}/WelcomeScreen/index.tsx`);
  return {
    navigation: {
      importLine: `import RootNavigator from '${navigation}';`,
      element: '<RootNavigator />',
      name: 'RootNavigator',
      specifier: navigation,
    },
    welcome: {
      importLine: `import WelcomeScreen from '${welcome}';`,
      element: '<WelcomeScreen />',
      name: 'WelcomeScreen',
      specifier: welcome,
    },
  };
}

/** App.tsx, or App.jsx in a JavaScript app. */
export function appEntryFileName(language?: AppLanguage): string {
  // The extension follows the app's language: React Native resolves both, but an
  // App.tsx in a project with no TypeScript at all is exactly the leftover the
  // language question exists to prevent.
  return `App.${language === 'javascript' ? 'jsx' : 'tsx'}`;
}

export async function patchAppEntry(options: AppEntryPatchOptions): Promise<void> {
  await fs.writeFile(path.join(options.appRoot, appEntryFileName(options.language)), buildAppEntrySource(options), 'utf8');
}

/** Exactly what init writes to the App entry. */
export function buildAppEntrySource(options: AppEntrySourceOptions): string {
  const layout = options.layout ?? DEFAULT_LAYOUT;
  const { importLine, element } = rootsFor(layout)[options.root];

  // The "where things live" table in the header lines up whichever language this
  // app is: the config files differ by one character between .ts and .js.
  const configExtension = options.language === 'javascript' ? '.js' : '.ts';
  const runtimeConfigFile = `${managedPath(layout, 'runtime.config')}${configExtension}`;
  const appConfigFile = `armemon.config${configExtension}`;
  const runtimeImport = specifierFor(APP_ENTRY, managedPath(layout, 'runtime.generated.ts'));
  const pathColumn =
    Math.max(runtimeConfigFile.length, `${EXAMPLES_DIR}/`.length, `${layout.managed}/`.length) + 4;
  // <RootNavigator /> -> RootNavigator, for prose that names it.
  const rootName = element.replace(/[<>/]/g, '').trim();

  return `/**
 * The app entry point. armemon wrote this once; it is yours now.
 *
 * WHAT THE FIRST TWO IMPORTS DO
 *   '${runtimeImport}' — imported for its side effect. It registers
 *   every plugin you selected, plus your own startup tasks, with @armemon-library/core
 *   BEFORE anything renders. armemon keeps it up to date as plugins are added and
 *   removed; don't edit it. Your own settings go in ${runtimeConfigFile} next to it.
 *
 *   <KitProvider> — runs the startup tasks, shows the splash while they run, shows
 *   the error screen if a critical one fails, and wraps its children in every
 *   plugin's provider in the right order. It takes no props on purpose: everything
 *   it needs came from the registration above, so there is nothing here to keep in
 *   sync by hand.
 *
 * WHERE THINGS LIVE
 *   ${`${SCREENS_DIR}/`.padEnd(pathColumn)}your screens, one folder each — yours to edit
 *   ${`${SHARED_DIR}/`.padEnd(pathColumn)}components, hooks and utils more than one screen uses
 *   ${`${layout.managed}/`.padEnd(pathColumn)}armemon's own files — commands write and re-edit these
 *   ${runtimeConfigFile.padEnd(pathColumn)}your startup tasks and runtime overrides
 *   ${`${EXAMPLES_DIR}/`.padEnd(pathColumn)}armemon's stock parts; replace or delete them
 *   ${appConfigFile.padEnd(pathColumn)}a record of the choices this app was scaffolded with
 *
 * ADDING A SCREEN
 *   armemon create-screen Order
 *
 *   Creates ${SCREENS_DIR}/OrderScreen/, registers the route in your navigator and
 *   param list, and adds a deep-link path if you have linking on.
 *
 * CHANGING WHAT RENDERS
 *   Replace ${rootName} with your own root component — this file is not
 *   regenerated, so it will not be overwritten.
 *
 * ADDING A PROVIDER OF YOUR OWN
 *   Anything that must sit outside the plugin tree wraps <KitProvider>; anything
 *   that only needs to be above your screens goes inside it, around ${rootName}.
 */
import React from 'react';
import { KitProvider } from '@armemon-library/core';
import '${runtimeImport}';
${importLine}

export default function App() {
  return (
    <KitProvider>
      ${element}
    </KitProvider>
  );
}
`;
}

/**
 * Makes an existing App entry render `to` instead of the other root.
 *
 * Only the default import and a bare `<Root />` element are changed, plus the two
 * places the header comment names the root. Anything else using the old root — a
 * prop on it, a second reference — is refused: those are decisions about the app,
 * not wiring.
 */
export function swapAppEntryRoot(
  content: string,
  to: AppRootChoice,
  options: { language?: AppLanguage; layout?: AppLayout } = {},
): PatchResult {
  const fileName = appEntryFileName(options.language);
  const roots = rootsFor(options.layout ?? DEFAULT_LAYOUT);
  const target = roots[to];
  const source = roots[to === 'navigation' ? 'welcome' : 'navigation'];
  const manual = `In ${fileName}, import ${target.name} from '${target.specifier}' and render <${target.name} /> where <${source.name} /> is.`;

  const broken = brokenReason(content, fileName);
  if (broken) return refused(content, broken, manual);

  const file = parseSource(content, fileName);
  const imports = file.statements.filter(ts.isImportDeclaration);
  const importOf = (root: typeof target) =>
    imports.find(
      (declaration) =>
        declaration.importClause?.name?.text === root.name &&
        ts.isStringLiteral(declaration.moduleSpecifier) &&
        samePathSpec(declaration.moduleSpecifier.text, root.specifier),
    );

  const existing = importOf(source);
  if (!existing) {
    if (importOf(target)) return done(content, `${fileName} already renders ${target.name}`);
    return refused(content, `${fileName} doesn't import ${source.name}, so armemon can't tell what it renders`, manual);
  }
  if (existing.importClause?.namedBindings) {
    return refused(content, `${fileName} imports more than ${source.name} from that module`, manual);
  }

  const elements: Array<ts.JsxSelfClosingElement> = [];
  let otherUses = 0;
  walk(file, (node) => {
    if (!ts.isIdentifier(node) || node.text !== source.name || node.parent === existing.importClause) return;
    const parent = node.parent;
    if (ts.isJsxSelfClosingElement(parent) && parent.tagName === node && parent.attributes.properties.length === 0) {
      elements.push(parent);
    } else {
      otherUses += 1;
    }
  });
  if (elements.length !== 1 || otherUses > 0) {
    return refused(content, `${fileName} uses ${source.name} somewhere other than one plain <${source.name} />`, manual);
  }
  if (importOf(target)) {
    return refused(content, `${fileName} already imports ${target.name}`, manual);
  }

  const style = importStyleOf(file);
  const edits: TextEdit[] = [
    {
      start: existing.getStart(file),
      end: existing.getEnd(),
      text: `import ${target.name} from ${quoteString(target.specifier, style.quote)}${style.semicolon ? ';' : ''}`,
    },
    { start: elements[0]!.getStart(file), end: elements[0]!.getEnd(), text: `<${target.name} />` },
  ];

  // The header's two mentions of what renders, when it still has them.
  const header = ts.getLeadingCommentRanges(content, 0)?.[0];
  if (header) {
    for (const phrase of [`Replace ${source.name} with`, `around ${source.name}.`]) {
      const at = content.indexOf(phrase, header.pos);
      if (at !== -1 && at < header.end) {
        edits.push({ start: at, end: at + phrase.length, text: phrase.replace(source.name, target.name) });
      }
    }
  }

  return checked(content, applyEdits(content, edits), fileName, manual);
}
