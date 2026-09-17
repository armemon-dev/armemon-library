/**
 * FILE: createScreen.ts
 * PATH: packages/cli-armemon/src/flows/createScreen.ts
 *
 * WHAT: `armemon create-screen <Name>` — creates a screen folder and registers the
 *       route everywhere it has to be registered: the navigator it belongs to, that
 *       navigator's param list, and the deep-linking config, nested under the routes
 *       that navigator is rendered from.
 * WHY:  Adding a screen by hand is four edits and three of them are forgettable: the
 *       component, the <Screen> line, the param-list entry, the deep-link path. Miss
 *       the second and the screen is unreachable; miss the third and navigate() is a
 *       type error in an unrelated file; miss the fourth and the link opens nothing.
 * HOW:  Everything is decided before anything is written. Flags are checked against
 *       each other, the navigators are mapped from disk, conflicts stop the command,
 *       and every edit is made in memory and parse-checked. Then it all lands at once
 *       — or, if a write fails, none of it does. An edit armemon can't make safely is
 *       skipped with the exact text to add by hand, and the command exits 1 so a
 *       script notices. Re-running with --force and new options (--params, --link,
 *       --initial, --modal, --title) updates the existing registration rather than
 *       reporting it "already there". --dry-run stops right before writing.
 * WHEN: On demand, inside an app scaffolded by armemon.
 *
 * EXPORTS: runCreateScreenFlow, CreateScreenOptions
 * DEPENDS ON: node:path, @armemon-library/cli-kit, @armemon-library/config-types, ./screenShared
 * USED BY: packages/cli-armemon/src/commands/createScreen.ts
 */

import path from 'node:path';
import {
  CliError,
  logger,
  promptText,
  promptConfirm,
  promptSelect,
  isAutoAcceptEnabled,
  isInteractive,
  buildScreenFiles,
  convertFilesToJavaScript,
  normalizeScreenName,
  validateLinkingPath,
  parseRouteParams,
  linkingPathParams,
  mergeRouteParams,
  paramListEntryType,
  linkingParsersFor,
  navigateExample,
  discoverNavigation,
  registerScreenInNavigator,
  addRouteToParamList,
  addLinkingRoute,
  linkingPathOf,
  managedFile,
  nestLinkingRoutes,
  type NavigatorLocation,
  type RouteParam,
  type ScreenName,
  type ScreenTyping,
} from '@armemon-library/cli-kit';
import type { PluginInstallPlan } from '@armemon-library/config-types';
import {
  ChangeSet,
  applyOutputMode,
  commit,
  emit,
  filesUnder,
  indexFiles,
  moduleSpecifier,
  openApp,
  printChanges,
  printOutcomes,
  printVerification,
  realignManaged,
  verificationSummary,
  verifyApp,
  type ScreenCommandOptions,
} from './screenShared.js';

export interface CreateScreenOptions extends ScreenCommandOptions {
  name?: string;
  full?: boolean;
  flat?: boolean;
  /** true: register without asking. false: don't touch navigation. undefined: ask. */
  register?: boolean;
  /** stack, tabs, drawer, a navigator variable (Tab), or File:Variable. */
  navigator?: string;
  link?: string;
  noLink?: boolean;
  /** `id:string,page?:number`. */
  params?: string;
  initial?: boolean;
  modal?: boolean;
  title?: string;
  force?: boolean;
}

/** Flags that only mean something for a screen that gets registered. */
function navigatorFlags(options: CreateScreenOptions): string[] {
  return [
    options.navigator !== undefined && '--navigator',
    options.link !== undefined && '--link',
    options.params !== undefined && '--params',
    options.initial && '--initial',
    options.modal && '--modal',
    options.title !== undefined && '--title',
  ].filter((flag): flag is string => typeof flag === 'string');
}

const fileStem = (file: string) => path.basename(file).replace(/\.[jt]sx?$/, '');

function matchNavigators(navigators: NavigatorLocation[], wanted: string): NavigatorLocation[] {
  const lower = wanted.toLowerCase();
  const kind = lower === 'tab' ? 'tabs' : lower;
  return navigators.filter(
    (navigator) =>
      navigator.variable === wanted || navigator.kind === kind || `${fileStem(navigator.file)}:${navigator.variable}` === wanted,
  );
}

/**
 * A required param the deep link can't carry: the types promise it's there, and a link
 * opens the screen without it.
 */
function paramWarnings(declared: RouteParam[], linkPath: string | null): string[] {
  if (linkPath === null) return [];
  const inPath = linkingPathParams(linkPath);
  const warnings: string[] = [];
  for (const param of declared) {
    if (param.optional) continue;
    const segment = inPath.find((entry) => entry.name === param.name);
    if (!segment) {
      warnings.push(
        `${param.name} is required, but the deep link ${linkPath} has no :${param.name} — a link without ?${param.name}=… opens the screen without it. Put :${param.name} in the path, or make it optional (${param.name}?:${param.type}).`,
      );
    } else if (segment.optional) {
      warnings.push(
        `${param.name} is required, but the deep link marks it optional (:${param.name}?). Drop the ?, or make the param optional (${param.name}?:${param.type}).`,
      );
    }
  }
  return warnings;
}

export async function runCreateScreenFlow(options: CreateScreenOptions): Promise<void> {
  applyOutputMode(options);

  // ---- flags, before anything is read ----------------------------------------
  if (options.full && options.flat) {
    throw new CliError('--full and --flat contradict each other.', 'Pass one of them, or neither to be asked.');
  }
  const needsNavigator = navigatorFlags(options);
  if (options.register === false && needsNavigator.length > 0) {
    throw new CliError(
      `${needsNavigator.join(', ')} ${needsNavigator.length === 1 ? 'means' : 'mean'} nothing with --no-register.`,
      'Drop --no-register to register the screen, or drop those flags.',
    );
  }
  if (options.noLink && options.link !== undefined) {
    throw new CliError('--link and --no-link contradict each other.', 'Pass one of them.');
  }
  if (options.link !== undefined) {
    const problem = validateLinkingPath(options.link);
    if (problem) throw new CliError(`--link "${options.link}" is not a usable deep-link path.`, problem);
  }
  let declaredParams: RouteParam[] = [];
  if (options.params !== undefined) {
    try {
      declaredParams = parseRouteParams(options.params);
    } catch (error) {
      throw new CliError(`--params "${options.params}" can't be read.`, error instanceof Error ? error.message : String(error));
    }
  }
  if (!options.name && isAutoAcceptEnabled()) {
    throw new CliError('Give the screen a name — there is no sensible default to accept.', 'e.g. armemon create-screen Order');
  }

  const { appRoot, config, layout } = await openApp(options);
  const isJavaScript = config.language === 'javascript';
  const relative = (file: string) => path.relative(appRoot, file).split(path.sep).join('/');

  const typed = options.name ?? (await promptText({
    message: 'Screen name?',
    placeholder: 'Order',
    validate: (value) => {
      try {
        normalizeScreenName(value);
        return undefined;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
  }));

  let screen: ScreenName;
  try {
    screen = normalizeScreenName(typed);
  } catch (error) {
    throw new CliError(
      error instanceof Error ? error.message : String(error),
      'Give a route name like Order, OrderScreen, or order-history.',
    );
  }
  const { routeName, componentName } = screen;
  const folder = path.join(appRoot, screen.folder);
  const indexFile = path.join(folder, `index.${isJavaScript ? 'jsx' : 'tsx'}`);

  const existingIndexes = await indexFiles(folder);
  if (existingIndexes.length > 0 && !options.force) {
    throw new CliError(`${screen.folder} already exists.`, 'Pass --force to replace its index, or pick another name.');
  }
  if (existingIndexes.length > 0 && !options.dryRun && !isAutoAcceptEnabled() && isInteractive()) {
    const replace = await promptConfirm({
      message: `Replace ${relative(existingIndexes[0]!)}? Anything you changed in it will be lost.`,
      initialValue: false,
    });
    if (!replace) throw new CliError('Nothing was changed.');
  }

  // ---- the app's navigation, as it is on disk --------------------------------
  const navigation = await discoverNavigation(appRoot, { layout });
  if (navigation.rootFile && navigation.unparsable.includes(navigation.rootFile) && options.register !== false) {
    throw new CliError(
      `${relative(navigation.rootFile)} doesn't parse, so armemon can't read your navigators.`,
      'Fix the syntax error first (tsc or your editor will point at it), or pass --no-register.',
    );
  }
  const navigators = navigation.navigators.filter((navigator) => !navigator.isStatic);
  const describe = (navigator: NavigatorLocation) => `${navigator.variable} (${navigator.kind}) in ${relative(navigator.file)}`;

  if (navigators.length === 0 && (options.register === true || needsNavigator.length > 0)) {
    throw new CliError(
      navigation.navigators.length > 0
        ? "This app declares its navigators with the static API (createXNavigator({ screens })), which armemon doesn't edit yet."
        : navigation.rootFile
          ? 'RootNavigator does not create a navigator armemon recognizes.'
          : 'This app has no RootNavigator to register a screen in.',
      `${needsNavigator.length > 0 ? needsNavigator.join(', ') : '--register'} needs one. Run "armemon create-screen" with --no-register, or add React Navigation first.`,
    );
  }

  let candidates = navigators;
  if (options.navigator !== undefined) {
    candidates = matchNavigators(navigators, options.navigator);
    if (candidates.length === 0) {
      throw new CliError(
        `--navigator "${options.navigator}" doesn't match a navigator in this app.`,
        `This app has: ${navigators.map(describe).join('; ')}.`,
      );
    }
    if (candidates.length > 1) {
      const example = candidates[0]!;
      throw new CliError(
        `--navigator "${options.navigator}" matches more than one navigator: ${candidates.map(describe).join('; ')}.`,
        `Name one by its variable, or as File:Variable — e.g. --navigator ${fileStem(example.file)}:${example.variable}.`,
      );
    }
  }

  const shape = options.flat
    ? 'flat'
    : options.full
      ? 'full'
      : (await promptConfirm({ message: 'Create components/, hooks/, utils/ and assets/ folders too?', initialValue: true }))
        ? 'full'
        : 'flat';

  const shouldRegister = navigators.length > 0 && (options.register ?? (needsNavigator.length > 0
    ? true
    : await promptConfirm({ message: `Register "${routeName}" in a navigator?`, initialValue: true })));

  let target: NavigatorLocation | undefined;
  if (shouldRegister) {
    if (candidates.length === 1) {
      target = candidates[0];
    } else {
      const tabs = candidates.findIndex((navigator) => navigator.kind === 'tabs');
      const choice = await promptSelect<string>({
        message: 'Which navigator?',
        options: candidates.map((navigator, index) => ({
          value: String(index),
          label: `${navigator.variable} (${navigator.kind})`,
          hint: relative(navigator.file),
        })),
        initialValue: String(Math.max(tabs, 0)),
      });
      target = candidates[Number(choice)];
    }
  }

  if (options.modal && target && target.kind !== 'stack') {
    throw new CliError(
      `--modal only works in a stack navigator, and ${target.variable} is a ${target.kind === 'tabs' ? 'tab' : 'drawer'} navigator.`,
      'Pick a stack with --navigator, or drop --modal.',
    );
  }

  const changes = new ChangeSet(appRoot);

  // Before anything patches them. Every edit below is parser-backed, and a file left
  // in some other shape by hand is what those edits cope with worst — so canonicalize
  // first and let the rest of this run build on text armemon can read.
  await realignManaged(changes, layout, [
    target?.file,
    target?.paramListFile,
    navigation.linkingFile,
  ]);

  const alreadyRegistered = Boolean(target?.routes.some((route) => route.name === routeName));

  // ---- the deep link ----------------------------------------------------------
  let linkPath: string | null = null;
  let linkProblem: string | null = null;
  if (target && !options.noLink) {
    const linkingFile = navigation.linkingFile;
    if (!linkingFile) {
      if (options.link !== undefined) {
        throw new CliError(
          '--link needs a deep-linking config, and this app has none.',
          `Turn deep linking on in ${managedFile.linking(layout)}, or drop --link.`,
        );
      }
    } else if (target.nesting === null) {
      linkProblem = `couldn't tell where <${target.navigatorTag}> is rendered, so where its deep link belongs is unknown`;
    } else {
      // A re-run keeps the path already chosen, unless --link says otherwise.
      const existingPath = alreadyRegistered
        ? linkingPathOf((await changes.read(linkingFile)) ?? '', { fileName: linkingFile, routeName })
        : null;
      linkPath = options.link ?? existingPath ?? (await promptText({
        message: 'Deep-link path?',
        placeholder: screen.linkingPath,
        defaultValue: screen.linkingPath,
        validate: validateLinkingPath,
      }));
    }
  }

  // ---- the screen's files -------------------------------------------------------
  const params = mergeRouteParams(declaredParams, linkPath ? linkingPathParams(linkPath) : []);
  const warnings = paramWarnings(declaredParams, linkPath);
  const typing: ScreenTyping | undefined =
    !isJavaScript && target?.paramListFile && target.paramListName && params.length > 0
      ? {
          propsType: target.screenProps.type,
          propsPackage: target.screenProps.package,
          paramListType: target.paramListName,
          paramListImport: moduleSpecifier(indexFile, target.paramListFile),
        }
      : undefined;

  let files: PluginInstallPlan['filesToWrite'] = buildScreenFiles({
    routeName,
    shape,
    language: config.language,
    kind: 'blank',
    params,
    typing,
    nesting: target?.nesting ?? [],
    layout,
  });
  if (isJavaScript) files = (await convertFilesToJavaScript(files)).files;

  // ---- every edit, in memory ----------------------------------------------------
  let registered = false;

  if (target) {
    const destination = target;
    for (const navigator of navigation.navigators) {
      const route = navigator.routes.find((entry) => entry.name === routeName);
      if (route && !(navigator === destination && (route.component === null || route.component === componentName))) {
        throw new CliError(
          `"${routeName}" is already a route in <${navigator.navigatorTag}> (${relative(navigator.file)})${route.component ? `, rendering ${route.component}` : ''}.`,
          route.component === componentName
            ? `Nothing was written. To move it to <${destination.navigatorTag}>, run armemon remove-screen ${routeName} --keep-files, then armemon create-screen ${routeName} --force --navigator ${destination.variable}.`
            : 'Nothing was written. Pick another name, or rename that screen first with armemon rename-screen.',
        );
      }
    }

    const screenOptions: Record<string, string> = {};
    if (options.modal) screenOptions.presentation = 'modal';
    if (options.title !== undefined) screenOptions.title = options.title;

    const registration = await changes.patch(
      destination.file,
      (content) => registerScreenInNavigator(content, {
        fileName: destination.file,
        componentName,
        routeName,
        importPath: moduleSpecifier(destination.file, path.join(folder, 'index')),
        navigatorVariable: destination.variable,
        initial: options.initial,
        screenOptions,
      }),
      { action: `${alreadyRegistered ? 'updated' : 'registered'} ${routeName} in <${destination.navigatorTag}>` },
    );
    if (registration.conflict) {
      throw new CliError(
        `Can't register ${routeName}: ${registration.reason}.`,
        'Nothing was written. Pick another name, or rename the existing one first with armemon rename-screen.',
      );
    }
    registered = registration.status !== 'skipped';
    const paramsType = paramListEntryType(params);
    const listManual = (list: string) => `${routeName}: ${paramsType};   // in ${list}`;

    if (!isJavaScript) {
      const listFile = destination.paramListFile;
      const listName = destination.paramListName;
      if (listFile && listName) {
        if (!registered) {
          changes.skip(listFile, 'left alone until the screen is registered', listManual(listName));
        } else {
          await changes.patch(
            listFile,
            (content) => addRouteToParamList(content, {
              fileName: listFile,
              routeName,
              typeName: listName,
              paramsType,
              replaceType: options.params !== undefined,
            }),
            { action: alreadyRegistered ? `updated ${routeName} in ${listName}` : `added ${routeName} to ${listName}` },
          );
        }
      } else if (destination.paramListType) {
        changes.skip(destination.file, `couldn't find where ${destination.paramListType} is declared`, listManual(destination.paramListType));
      } else if (navigation.rootParamList) {
        changes.skip(
          destination.file,
          `<${destination.navigatorTag}> has no param list of its own, but the app types its routes through ${navigation.rootParamList.name}, so ${routeName} needs a type where this navigator's params are declared`,
          listManual(`the param list for <${destination.navigatorTag}>`),
        );
      }
    }

    const linkingFile = navigation.linkingFile;
    if (linkingFile && linkPath !== null) {
      const resolvedPath = linkPath;
      const nesting = destination.nesting ?? [];
      if (!registered) {
        changes.skip(linkingFile, 'left alone until the screen is registered', `${routeName}: '${resolvedPath}',`);
      } else {
        if (nesting.length > 0) {
          const rootRoutes = new Set(
            navigation.navigators.filter((navigator) => navigator.nesting?.length === 0).flatMap((navigator) => navigator.routes.map((route) => route.name)),
          );
          const stranded = [...new Set([...destination.routes.map((route) => route.name), routeName])].filter((name) => !rootRoutes.has(name));
          await changes.patch(
            linkingFile,
            (content) => nestLinkingRoutes(content, { fileName: linkingFile, routes: stranded, nesting }),
            {
              action: (result) => `moved the links for ${(result.names ?? []).join(', ')} under ${nesting.join(' → ')}, where React Navigation looks for them`,
              reportAlready: false,
            },
          );
        }
        await changes.patch(
          linkingFile,
          (content) => addLinkingRoute(content, {
            fileName: linkingFile,
            routeName,
            path: resolvedPath,
            parse: linkingParsersFor(params, config.language),
            nesting,
            update: { path: options.link !== undefined, parsers: options.params !== undefined },
            clearParsers: params.filter((param) => param.type === 'string').map((param) => param.name),
          }),
          { action: alreadyRegistered ? `updated the deep link ${resolvedPath}` : `added the deep link ${resolvedPath}` },
        );
      }
    } else if (linkingFile && linkProblem) {
      changes.skip(linkingFile, linkProblem, `${routeName}: '${options.link ?? screen.linkingPath}',`);
    }
  }

  const staleIndexes = existingIndexes.filter((file) => file !== indexFile);
  for (const stale of staleIndexes) {
    changes.record({ file: relative(stale), status: 'changed', action: `removed, replaced by ${path.basename(indexFile)} (Metro would load it first)` });
  }

  const generated = new Set(files.map((file) => path.join(appRoot, file.path)));
  const kept = existingIndexes.length > 0
    ? (await filesUnder(folder)).filter((file) => !generated.has(file) && !staleIndexes.includes(file)).map(relative)
    : [];
  const created = files.map((file) => file.path);
  const skipped = changes.outcomes.filter((outcome) => outcome.status === 'skipped');
  const summary = {
    command: 'create-screen',
    routeName,
    componentName,
    folder: screen.folder,
    navigator: target ? { variable: target.variable, kind: target.kind, file: relative(target.file), nesting: target.nesting } : null,
    linkingPath: linkPath,
    params,
    created,
    kept,
    warnings,
    edits: changes.outcomes,
  };

  if (options.dryRun) {
    if (!options.json) {
      logger.info('Dry run — nothing was written.');
      printChanges(changes, created);
      for (const stale of staleIndexes) logger.info(`Would delete ${relative(stale)}`);
      printOutcomes(changes, { onlyProblems: true });
      for (const warning of warnings) logger.warn(warning);
    }
    emit({ ok: skipped.length === 0, dryRun: true, ...summary, verification: null }, options);
    return;
  }

  await commit(changes, { create: files, deleteFiles: staleIndexes });
  const verification = await verifyApp(appRoot, config, options);
  const touched = [...created, ...changes.changes.map((change) => relative(change.file))];

  if (!options.json) {
    logger.success(`Created ${screen.folder}/`);
    if (kept.length > 0) logger.info(`Kept what was already in it: ${kept.join(', ')}.`);
    printOutcomes(changes);
    for (const warning of warnings) logger.warn(warning);
    if (registered) {
      logger.info(`Go to it with: ${navigateExample(routeName, target?.nesting ?? [], params)}`);
    } else if (!target) {
      logger.info(
        navigators.length > 0
          ? `Not registered. Add it yourself with: <Screen name="${routeName}" component={${componentName}} />`
          : navigation.rootFile
            ? `armemon couldn't find a navigator it recognizes in ${relative(navigation.rootFile)}, so nothing was wired up. Register it yourself — import ${componentName} from '${moduleSpecifier(navigation.rootFile, path.join(folder, 'index'))}'.`
            : `No navigator in this app, so nothing was wired up. Render it from App: import ${componentName} from './${screen.folder}';`,
      );
    }
    printVerification(verification, {
      touched,
      undoHint: alreadyRegistered ? undefined : `Undo it with: armemon remove-screen ${routeName}`,
    });
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
