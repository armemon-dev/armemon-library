/**
 * FILE: renameScreen.ts
 * PATH: packages/cli-armemon/src/flows/renameScreen.ts
 *
 * WHAT: `armemon rename-screen <From> <To>` — renames a screen everywhere it is
 *       named: its folder and component, its route in every navigator and param list,
 *       its deep-link entry (and the path, when the path was derived from the name),
 *       and every navigate(), screen param, typed props argument and import that
 *       points at it — named imports of the component included.
 * WHY:  A rename touches more files than any other screen change, and a missed one
 *       compiles in JavaScript and fails at runtime: navigate('Order') to a route now
 *       called Invoice goes nowhere. Anything that merely mentions the old name — a
 *       title, tags.push('Order') — is listed rather than rewritten, because only the
 *       author knows whether "Order" there meant the route.
 * HOW:  Map navigation, refuse if the new name is taken or a navigator can't be edited
 *       safely, compute every edit in memory (including the files inside the folder,
 *       staged at their new paths), then commit: move the folder, write the edits,
 *       and undo both if a write fails.
 * WHEN: On demand, inside an app scaffolded by armemon.
 *
 * EXPORTS: runRenameScreenFlow, RenameScreenOptions, renamedLinkPath
 * DEPENDS ON: node:path, node:fs/promises, @armemon-library/cli-kit, ./screenShared, ./removeScreen
 * USED BY: packages/cli-armemon/src/commands/renameScreen.ts
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import {
  CliError,
  appSourceFiles,
  discoverNavigation,
  findLinkUrlReferences,
  findRouteReferences,
  linkingPathOf,
  logger,
  normalizeScreenName,
  renameInComments,
  renameInScreenFile,
  renameLinkingRoute,
  renameRouteInParamList,
  renameRouteReferences,
  renameScreenInNavigator,
  validateLinkingPath,
  type ScreenName,
} from '@armemon-library/cli-kit';
import { listReferences, paramLists } from './removeScreen.js';
import {
  ChangeSet,
  applyOutputMode,
  commit,
  emit,
  filesUnder,
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

export interface RenameScreenOptions extends ScreenCommandOptions {
  from?: string;
  to?: string;
  /** A new deep-link path. */
  link?: string;
  /** Keep the current deep-link path even if it was derived from the old name. */
  keepLink?: boolean;
}

/**
 * A path that was derived from the old name follows the new one — in whichever form it
 * was written — and keeps any segments after it: `order/:id` → `invoice/:id`. A path
 * someone chose themselves (`checkout`) is left alone.
 */
export function renamedLinkPath(current: string, from: ScreenName, to: ScreenName): string {
  const kebab = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  const forms: Array<[string, string]> = [
    [from.linkingPath, to.linkingPath],
    [from.routeName, to.routeName],
    [from.routeName.toLowerCase(), to.routeName.toLowerCase()],
    [kebab(from.routeName), kebab(to.routeName)],
  ];
  const [head, ...rest] = current.split('/');
  const match = forms.find(([old]) => old === head);
  return match ? [match[1], ...rest].join('/') : current;
}

export async function runRenameScreenFlow(options: RenameScreenOptions): Promise<void> {
  applyOutputMode(options);
  if (!options.from || !options.to) throw new CliError('Name the screen and what to call it.', 'e.g. armemon rename-screen Order Invoice');
  if (options.link !== undefined && options.keepLink) {
    throw new CliError('--link and --keep-link contradict each other.', 'Pass one of them, or neither to let the path follow the new name.');
  }
  if (options.link !== undefined) {
    const problem = validateLinkingPath(options.link);
    if (problem) throw new CliError(`--link "${options.link}" is not a usable deep-link path.`, problem);
  }

  const { appRoot, config, layout } = await openApp(options);
  const relative = (file: string) => path.relative(appRoot, file).split(path.sep).join('/');
  const read = (value: string): ScreenName => {
    try {
      return normalizeScreenName(value);
    } catch (error) {
      throw new CliError(error instanceof Error ? error.message : String(error), 'Give a route name like Order, OrderScreen, or order-history.');
    }
  };
  const from = read(options.from);
  const to = read(options.to);
  if (from.routeName === to.routeName) {
    throw new CliError(`"${options.from}" and "${options.to}" are the same screen, ${from.routeName}.`, 'To change only its deep-link path, edit navigation.config.');
  }

  const fromFolder = path.join(appRoot, from.folder);
  const toFolder = path.join(appRoot, to.folder);
  if (await pathExists(toFolder)) {
    throw new CliError(`${to.folder} already exists.`, 'Pick another name, or remove that screen first with armemon remove-screen.');
  }
  const fromExists = await pathExists(fromFolder);

  const navigation = await discoverNavigation(appRoot, { layout });
  if (navigation.rootFile && navigation.unparsable.includes(navigation.rootFile)) {
    throw new CliError(
      `${relative(navigation.rootFile)} doesn't parse, so armemon can't read your navigators.`,
      'Fix the syntax error first — tsc or your editor will point at it.',
    );
  }
  for (const navigator of navigation.navigators) {
    if (navigator.routes.some((route) => route.name === to.routeName)) {
      throw new CliError(
        `"${to.routeName}" is already a route in <${navigator.navigatorTag}> (${relative(navigator.file)}).`,
        'Pick another name, or remove that screen first with armemon remove-screen.',
      );
    }
  }
  const registrations = navigation.navigators.filter((navigator) => navigator.routes.some((route) => route.name === from.routeName));
  if (!fromExists && registrations.length === 0) {
    throw new CliError(
      `There's no ${from.routeName} screen: no navigator registers "${from.routeName}" and ${from.folder} doesn't exist.`,
      "The name works like create-screen's — Order, OrderScreen and order all mean the same screen.",
    );
  }
  const staticOne = registrations.find((navigator) => navigator.isStatic);
  if (staticOne) {
    throw new CliError(
      `${from.routeName} is registered in <${staticOne.navigatorTag}> (${relative(staticOne.file)}) with the static API, which armemon doesn't edit yet.`,
      'Rename it in that screens object by hand first.',
    );
  }

  // ---- every edit, in memory ----------------------------------------------------
  const changes = new ChangeSet(appRoot);

  await realignManaged(changes, layout, [
    ...registrations.map((navigator) => navigator.file),
    ...paramLists(registrations.length > 0 ? registrations : navigation.navigators).map(([file]) => file),
    navigation.linkingFile,
  ]);

  for (const file of new Set(registrations.map((navigator) => navigator.file))) {
    const result = await changes.patch(
      file,
      (content) => renameScreenInNavigator(content, {
        fileName: file,
        from: from.routeName,
        to: to.routeName,
        fromComponent: from.componentName,
        toComponent: to.componentName,
      }),
      { action: `renamed ${from.routeName} to ${to.routeName}` },
    );
    if (result.conflict) throw new CliError(`Can't rename ${from.routeName}: ${result.reason}.`, 'Nothing was written.');
    if (result.status === 'skipped') {
      throw new CliError(
        `Can't rename ${from.routeName} in ${relative(file)}: ${result.reason}.`,
        `Nothing was written. ${result.manual ?? ''} Then run this again for the rest.`.replace(/\s+/g, ' '),
      );
    }
  }

  for (const [file, typeName] of paramLists(registrations.length > 0 ? registrations : navigation.navigators)) {
    await changes.patch(
      file,
      (content) => renameRouteInParamList(content, { fileName: file, from: from.routeName, to: to.routeName, typeName }),
      { action: `renamed ${from.routeName} to ${to.routeName} in ${typeName}`, reportAlready: false },
    );
  }

  let linkingPath: { from: string; to: string } | null = null;
  const linkingFile = navigation.linkingFile;
  if (linkingFile) {
    const current = linkingPathOf((await changes.read(linkingFile)) ?? '', { fileName: linkingFile, routeName: from.routeName });
    const nextPath = current === null ? undefined : (options.link ?? (options.keepLink ? current : renamedLinkPath(current, from, to)));
    if (current !== null && nextPath !== undefined) linkingPath = { from: current, to: nextPath };

    // Renamed even without a path of its own: a route that renders a nested navigator is
    // an entry keyed by name, and every link under it hangs off that key.
    const result = await changes.patch(
      linkingFile,
      (content) => renameLinkingRoute(content, { fileName: linkingFile, from: from.routeName, to: to.routeName, path: nextPath }),
      {
        action: current === null
          ? `renamed the ${from.routeName} linking entry`
          : nextPath === current ? `renamed the deep-link entry (path stays ${current})` : `moved the deep link from ${current} to ${nextPath}`,
        reportAlready: false,
      },
    );
    if (options.link !== undefined && current === null) {
      changes.skip(
        linkingFile,
        result.changed ? `${from.routeName}'s linking entry has no path of its own to change` : `${from.routeName} has no deep link to change`,
        `${to.routeName}: '${options.link}',`,
      );
    }
  }

  const target = {
    routeName: from.routeName,
    folder: fromFolder,
    componentName: from.componentName,
    to: to.routeName,
    toFolder,
    toComponent: to.componentName,
  };
  const unhandled: Array<{ file: string; line: number; text: string }> = [];
  const names = { from: from.routeName, to: to.routeName, fromComponent: from.componentName, toComponent: to.componentName };
  const navigatorFiles = new Set(registrations.map((navigator) => navigator.file));

  for (const file of await appSourceFiles(appRoot)) {
    if (isInside(file, fromFolder)) continue;
    const content = await changes.read(file);
    if (content === null || (!content.includes(from.routeName) && !content.includes(from.componentName))) continue;

    const count = findRouteReferences(content, file, target).filter((reference) => reference.kind !== 'mention').length;
    const { result, unhandled: left } = renameRouteReferences(content, file, target);
    unhandled.push(...left.map((reference) => ({ file: relative(file), line: reference.line, text: reference.text })));
    if (!result.changed && !result.already) {
      changes.skip(file, result.reason ?? "couldn't update its references", `Change the references to ${from.routeName} by hand.`);
      continue;
    }

    // Comments are only renamed where the code was: those are the docs now out of date.
    const code = result.changed ? result.content : content;
    const next = result.changed || navigatorFiles.has(file) ? renameInComments(code, file, names) : code;
    if (next === content) continue;
    await changes.stage(file, next);
    changes.record({
      file: relative(file),
      status: 'changed',
      action: count > 0
        ? `updated ${count} reference${count === 1 ? '' : 's'} to ${from.routeName}`
        : result.changed ? `updated its imports of ${from.componentName}` : `updated ${from.routeName} in its comments`,
    });
  }

  const moves: Array<[string, string]> = [];
  if (fromExists) {
    moves.push([fromFolder, toFolder]);
    changes.record({ file: from.folder, status: 'changed', action: `moved to ${to.folder}` });

    for (const file of await filesUnder(fromFolder)) {
      const isSource = /\.[jt]sx?$/.test(file) && !file.endsWith('.d.ts');
      if (!isSource && !file.endsWith('.md')) continue;

      const original = await fs.readFile(file, 'utf8');
      const destination = path.join(toFolder, path.relative(fromFolder, file));
      let next = original;
      if (isSource) {
        next = renameInScreenFile(next, file, names);
        const { result, unhandled: left } = renameRouteReferences(next, file, target);
        if (result.changed) next = result.content;
        unhandled.push(...left.map((reference) => ({ file: relative(destination), line: reference.line, text: reference.text })));
      } else {
        next = next.replace(new RegExp(`\\b${from.componentName}\\b`, 'g'), to.componentName);
      }
      if (next !== original) await changes.stage(destination, next, original);
    }
  }

  // URLs that open the old path by hand compile fine and go nowhere once it moves.
  const staleLinks: Array<{ file: string; line: number; text: string }> = [];
  if (linkingPath && linkingPath.from !== linkingPath.to) {
    for (const file of await appSourceFiles(appRoot)) {
      if (file === linkingFile) continue;
      const content = await fs.readFile(file, 'utf8').catch(() => null);
      if (content === null) continue;
      const shownAs = isInside(file, fromFolder) ? path.join(toFolder, path.relative(fromFolder, file)) : file;
      for (const reference of findLinkUrlReferences(content, file, linkingPath.from)) {
        staleLinks.push({ file: relative(shownAs), line: reference.line, text: reference.text });
      }
    }
  }

  const skipped = changes.outcomes.filter((outcome) => outcome.status === 'skipped');
  const summary = {
    command: 'rename-screen',
    from: { routeName: from.routeName, componentName: from.componentName, folder: from.folder },
    to: { routeName: to.routeName, componentName: to.componentName, folder: to.folder },
    movedFolder: fromExists,
    linkingPath,
    edits: changes.outcomes,
    unhandled,
    staleLinks,
  };

  if (options.dryRun) {
    if (!options.json) {
      logger.info('Dry run — nothing was written.');
      if (fromExists) logger.info(`Would move ${from.folder}/ to ${to.folder}/`);
      printChanges(changes);
      printOutcomes(changes, { onlyProblems: true });
      if (staleLinks.length > 0) logger.warn(`These open /${linkingPath?.from}, which would go nowhere:\n${listReferences(staleLinks)}`);
    }
    emit({ ok: skipped.length === 0, dryRun: true, ...summary, verification: null }, options);
    return;
  }

  await commit(changes, { moves });
  const verification = await verifyApp(appRoot, config, options);
  const touched = changes.changes.map((change) => relative(change.file));

  if (!options.json) {
    printOutcomes(changes);
    if (unhandled.length > 0) {
      logger.info(`"${from.routeName}" still appears here — check whether these meant the route:\n${listReferences(unhandled)}`);
    }
    if (staleLinks.length > 0) {
      logger.warn(`These still open /${linkingPath?.from}, which now goes nowhere — point them at /${linkingPath?.to}:\n${listReferences(staleLinks)}`);
    }
    printVerification(verification, { touched, undoHint: `Undo it with: armemon rename-screen ${to.routeName} ${from.routeName}` });
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
