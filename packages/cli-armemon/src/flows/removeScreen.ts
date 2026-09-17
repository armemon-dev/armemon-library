/**
 * FILE: removeScreen.ts
 * PATH: packages/cli-armemon/src/flows/removeScreen.ts
 *
 * WHAT: `armemon remove-screen <Name>` — create-screen in reverse: unregisters the
 *       route from every navigator that has it, drops it from their param lists and
 *       from the deep-linking config, removes imports nothing else uses, and deletes
 *       the screen's folder.
 * WHY:  Removing a screen by hand is the same forgettable edits as adding one, and
 *       the ones people miss fail late: a stale param-list entry keeps navigate()
 *       compiling for a route that no longer exists, and a navigate('Order') left in
 *       another screen crashes only when someone taps it. So this refuses while code
 *       still navigates to the route — listing exactly where — unless --force.
 *
 *       Some things it refuses even with --force, because going ahead can only break
 *       the app: a registration it can't remove safely (the folder would be deleted
 *       while the navigator still imports it), a route that renders a whole navigator
 *       (every screen and link under it would go too), and deleting a folder other
 *       files still import from.
 * HOW:  Same shape as create-screen: map navigation, check what would break, compute
 *       every edit in memory, then commit all-or-nothing. The folder is deleted last,
 *       after every edit has landed, because a deletion can't be put back.
 * WHEN: On demand, inside an app scaffolded by armemon.
 *
 * EXPORTS: runRemoveScreenFlow, RemoveScreenOptions, listReferences, paramLists
 * DEPENDS ON: node:path, @armemon-library/cli-kit, ./screenShared
 * USED BY: packages/cli-armemon/src/commands/removeScreen.ts, ./renameScreen.ts
 */

import path from 'node:path';
import {
  BLOCKING_REFERENCE_KINDS,
  CliError,
  appSourceFiles,
  discoverNavigation,
  findLinkUrlReferences,
  findRouteReferences,
  importsNameFrom,
  isAutoAcceptEnabled,
  isInteractive,
  linkingPathOf,
  logger,
  normalizeScreenName,
  promptConfirm,
  reexportsInto,
  removeLinkingRoute,
  removeReexports,
  removeRouteFromParamList,
  unregisterScreenFromNavigator,
  type NavigatorLocation,
  type RouteReference,
  type ScreenName,
} from '@armemon-library/cli-kit';
import {
  ChangeSet,
  applyOutputMode,
  commit,
  emit,
  isInside,
  openApp,
  pathExists,
  printChanges,
  printOutcomes,
  printVerification,
  realignManaged,
  verificationSummary,
  verifyApp,
  type ScreenCommandOptions,
} from './screenShared.js';

export interface RemoveScreenOptions extends ScreenCommandOptions {
  name?: string;
  /** Unregister it but leave its folder on disk. */
  keepFiles?: boolean;
  /** Remove it even while code references it, or while it is an initial route. */
  force?: boolean;
}

type FoundReference = RouteReference & { file: string };

export function listReferences(references: Array<{ file: string; line: number; text: string }>): string {
  const shown = references.slice(0, 12).map((reference) => `  ${reference.file}:${reference.line}  ${reference.text}`);
  if (references.length > 12) shown.push(`  …and ${references.length - 12} more`);
  return shown.join('\n');
}

/** Each (file, type name) pair once: several navigators can share one param list. */
export function paramLists(navigators: NavigatorLocation[]): Array<[string, string]> {
  const seen = new Set<string>();
  const lists: Array<[string, string]> = [];
  for (const navigator of navigators) {
    if (!navigator.paramListFile || !navigator.paramListName) continue;
    const key = `${navigator.paramListFile}\0${navigator.paramListName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lists.push([navigator.paramListFile, navigator.paramListName]);
  }
  return lists;
}

/** Navigators rendered by this route in one of the navigators that registers it. */
function navigatorsRenderedBy(routeName: string, registrations: NavigatorLocation[], all: NavigatorLocation[]): NavigatorLocation[] {
  return all.filter((child) => {
    const childNesting = child.nesting;
    return childNesting !== null && registrations.some((parent) =>
      parent.nesting !== null &&
      childNesting.length === parent.nesting.length + 1 &&
      childNesting[parent.nesting.length] === routeName &&
      parent.nesting.every((segment, index) => childNesting[index] === segment));
  });
}

export async function runRemoveScreenFlow(options: RemoveScreenOptions): Promise<void> {
  applyOutputMode(options);
  if (!options.name) throw new CliError('Name the screen to remove.', 'e.g. armemon remove-screen Order');

  const { appRoot, config, layout } = await openApp(options);
  const relative = (file: string) => path.relative(appRoot, file).split(path.sep).join('/');

  let screen: ScreenName;
  try {
    screen = normalizeScreenName(options.name);
  } catch (error) {
    throw new CliError(error instanceof Error ? error.message : String(error), 'Give a route name like Order, OrderScreen, or order-history.');
  }
  const { routeName, componentName } = screen;
  const folder = path.join(appRoot, screen.folder);
  const folderExists = await pathExists(folder);

  const navigation = await discoverNavigation(appRoot, { layout });
  if (navigation.rootFile && navigation.unparsable.includes(navigation.rootFile)) {
    throw new CliError(
      `${relative(navigation.rootFile)} doesn't parse, so armemon can't read your navigators.`,
      'Fix the syntax error first — tsc or your editor will point at it.',
    );
  }

  const registrations = navigation.navigators.filter((navigator) => navigator.routes.some((route) => route.name === routeName));
  if (!folderExists && registrations.length === 0) {
    throw new CliError(
      `There's no ${routeName} screen: no navigator registers "${routeName}" and ${screen.folder} doesn't exist.`,
      "The name works like create-screen's — Order, OrderScreen and order all mean the same screen.",
    );
  }

  const rendered = navigatorsRenderedBy(routeName, registrations, navigation.navigators);
  if (rendered.length > 0) {
    const child = rendered[0]!;
    const screens = child.routes.map((route) => route.name);
    throw new CliError(
      `"${routeName}" renders <${child.navigatorTag}> (${relative(child.file)})${screens.length > 0 ? `, with ${screens.join(', ')}` : ''}. Removing it would take that navigator's screens and deep links with it.`,
      `remove-screen removes screens, not navigators. Remove ${screens.length > 0 ? 'those screens' : 'the navigator'} first, or take it out by hand.`,
    );
  }

  for (const navigator of registrations) {
    const where = `<${navigator.navigatorTag}> (${relative(navigator.file)})`;
    if (navigator.isStatic) {
      throw new CliError(
        `${routeName} is registered in ${where} with the static API, which armemon doesn't edit yet.`,
        'Remove it from that screens object by hand, then run this again to clean up the rest.',
      );
    }
    if (options.force) continue;
    if (navigator.initialRouteName === routeName) {
      throw new CliError(
        `"${routeName}" is the initial route of ${where}.`,
        'Make another screen the initial route first (armemon create-screen <Name> --initial, or edit initialRouteName), or pass --force to remove it anyway and let the first remaining screen open instead.',
      );
    }
    if (navigator.routes.every((route) => route.name === routeName)) {
      throw new CliError(`"${routeName}" is the only screen in ${where}, and a navigator can't render with none.`, 'Add another screen to it first, or pass --force.');
    }
  }

  // ---- every edit, in memory ----------------------------------------------------
  const changes = new ChangeSet(appRoot);

  await realignManaged(changes, layout, [
    ...registrations.map((navigator) => navigator.file),
    ...paramLists(registrations).map(([file]) => file),
    navigation.linkingFile,
  ]);

  for (const file of new Set(registrations.map((navigator) => navigator.file))) {
    const owners = registrations
      .filter((navigator) => navigator.file === file)
      .map((navigator) => `<${navigator.navigatorTag}>`)
      .join(' and ');
    const result = await changes.patch(
      file,
      (content) => unregisterScreenFromNavigator(content, { fileName: file, routeName, dropInitialRoute: options.force }),
      { action: `removed ${routeName} from ${owners}` },
    );
    if (result.conflict) throw new CliError(`Can't remove ${routeName}: ${result.reason}.`, 'Nothing was written.');
    // Going on would delete the folder while the navigator still imports it.
    if (result.status === 'skipped') {
      throw new CliError(
        `Can't remove ${routeName} from ${relative(file)}: ${result.reason}.`,
        `Nothing was written. ${result.manual ?? ''} Then run this again to clean up its types, deep link and folder.`.replace(/\s+/g, ' '),
      );
    }
  }

  // Unregistered already (a half-finished edit, or an old armemon)? Then clean every list.
  for (const [file, typeName] of paramLists(registrations.length > 0 ? registrations : navigation.navigators)) {
    await changes.patch(
      file,
      (content) => removeRouteFromParamList(content, { fileName: file, routeName, typeName }),
      { action: `removed ${routeName} from ${typeName}`, reportAlready: false },
    );
  }

  const linkingFile = navigation.linkingFile;
  const removedPath = linkingFile
    ? linkingPathOf((await changes.read(linkingFile)) ?? '', { fileName: linkingFile, routeName })
    : null;
  if (linkingFile) {
    await changes.patch(
      linkingFile,
      (content) => removeLinkingRoute(content, { fileName: linkingFile, routeName }),
      { action: `removed ${routeName}'s deep link`, reportAlready: false },
    );
  }

  // ---- barrels that re-export it ------------------------------------------------------
  // A screens/index.ts re-exporting every screen would otherwise block every removal.
  // Its line for this screen goes when nothing imports that name from the barrel.
  const sourceFiles = await appSourceFiles(appRoot);
  const target = { routeName, folder, componentName };
  if (!options.keepFiles) {
    for (const barrel of sourceFiles) {
      if (isInside(barrel, folder)) continue;
      const content = await changes.read(barrel);
      if (content === null || !content.includes('export')) continue;
      const names = reexportsInto(content, barrel, target);
      if (!names || names.length === 0) continue;

      const unused: string[] = [];
      for (const name of names) {
        let used = false;
        for (const file of sourceFiles) {
          if (file === barrel || isInside(file, folder)) continue;
          const other = await changes.read(file);
          if (other !== null && other.includes(name) && (await importsNameFrom(other, file, barrel, name))) {
            used = true;
            break;
          }
        }
        if (!used) unused.push(name);
      }
      if (unused.length === 0) continue;
      await changes.patch(barrel, (text) => removeReexports(text, barrel, target, unused), {
        action: (result) => `removed its re-export of ${(result.names ?? unused).join(', ')}`,
      });
    }
  }

  // ---- what would still use it --------------------------------------------------
  const references: FoundReference[] = [];
  const staleLinks: Array<{ file: string; line: number; text: string }> = [];
  for (const file of sourceFiles) {
    if (isInside(file, folder)) continue;
    const content = await changes.read(file);
    if (content === null) continue;
    if (removedPath !== null && file !== linkingFile) {
      for (const reference of findLinkUrlReferences(content, file, removedPath)) {
        staleLinks.push({ file: relative(file), line: reference.line, text: reference.text });
      }
    }
    if (!content.includes(routeName) && !content.includes(componentName)) continue;
    for (const reference of findRouteReferences(content, file, target)) {
      references.push({ ...reference, file: relative(file) });
    }
  }
  const blocking = references.filter((reference) => BLOCKING_REFERENCE_KINDS.has(reference.kind));
  const mentions = references.filter((reference) => !BLOCKING_REFERENCE_KINDS.has(reference.kind));
  const importers = references.filter((reference) => reference.kind === 'import');

  if (blocking.length > 0 && !options.force) {
    throw new CliError(
      `${blocking.length === 1 ? 'One place still uses' : `${blocking.length} places still use`} ${routeName}:\n${listReferences(blocking)}`,
      'Change them first, or pass --force to remove it anyway and fix them afterwards.',
    );
  }

  let deleteFolder = false;
  if (folderExists && !options.keepFiles) {
    if (importers.length > 0) {
      changes.skip(
        folder,
        `kept, because ${importers.length === 1 ? 'a file still imports' : `${importers.length} files still import`} from it and deleting it would break the build`,
        listReferences(importers),
      );
    } else {
      deleteFolder = options.dryRun || isAutoAcceptEnabled() || !isInteractive()
        ? true
        : await promptConfirm({ message: `Delete ${screen.folder} and everything in it?`, initialValue: true });
    }
  }

  const skipped = changes.outcomes.filter((outcome) => outcome.status === 'skipped');
  const summary = {
    command: 'remove-screen',
    routeName,
    componentName,
    folder: screen.folder,
    deletedFolder: deleteFolder,
    edits: changes.outcomes,
    references: references.map((reference) => ({ file: reference.file, line: reference.line, kind: reference.kind, text: reference.text })),
    staleLinks,
  };

  if (options.dryRun) {
    if (!options.json) {
      logger.info('Dry run — nothing was written.');
      printChanges(changes);
      if (deleteFolder) logger.info(`Would delete ${screen.folder}/`);
      printOutcomes(changes, { onlyProblems: true });
      if (blocking.length > 0) logger.warn(`These would still use ${routeName}:\n${listReferences(blocking)}`);
      if (staleLinks.length > 0) logger.warn(`These would still open /${removedPath}, which would go nowhere:\n${listReferences(staleLinks)}`);
    }
    emit({ ok: skipped.length === 0, dryRun: true, ...summary, verification: null }, options);
    return;
  }

  await commit(changes, { removeFolders: deleteFolder ? [folder] : [] });
  const verification = await verifyApp(appRoot, config, options);
  const touched = changes.changes.map((change) => relative(change.file));

  if (!options.json) {
    printOutcomes(changes);
    if (deleteFolder) logger.success(`Deleted ${screen.folder}/`);
    else if (folderExists && options.keepFiles) logger.info(`Kept ${screen.folder}/.`);
    if (blocking.length > 0) logger.warn(`These still use ${routeName} and need changing:\n${listReferences(blocking)}`);
    if (mentions.length > 0) logger.info(`"${routeName}" still appears here — probably fine, but worth a look:\n${listReferences(mentions)}`);
    if (staleLinks.length > 0) logger.warn(`These still open /${removedPath}, which no longer goes anywhere:\n${listReferences(staleLinks)}`);
    printVerification(verification, { touched });
  }

  emit(
    {
      ok: skipped.length === 0 && (verification?.ok ?? true),
      dryRun: false,
      ...summary,
      verification: verificationSummary(verification, touched),
    },
    options,
  );
}
