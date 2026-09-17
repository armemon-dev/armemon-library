/**
 * FILE: link.ts
 * PATH: packages/cli-armemon/src/flows/link.ts
 *
 * WHAT: `armemon link list|add|remove` — reads and edits the app's deep-link config.
 * WHY:  Deep links are the part of navigation with no feedback loop: a wrong entry
 *       does not fail to compile, it just opens nothing when someone taps a URL
 *       months later. `list` is the answer to "what does this app actually respond
 *       to", and it has to show nesting, because that is what makes an entry work.
 * HOW:  `add` never takes the nesting on trust — it finds the navigator that
 *       registers the route and uses that. React Navigation resolves a FLAT entry for
 *       a tab screen against the root navigator, which has no such route, so a link
 *       written flat for a nested screen is silently dead. Refusing to guess is the
 *       same rule create-screen follows.
 * WHEN: On demand, inside a scaffolded app with deep linking turned on.
 *
 * EXPORTS: LinkOptions, runLinkFlow
 * DEPENDS ON: node:path, @armemon-library/cli-kit, ./screenShared
 * USED BY: packages/cli-armemon/src/commands/link.ts
 */

import path from 'node:path';
import {
  CliError,
  activeCodeOf,
  addLinkingRoute,
  discoverNavigation,
  linkingRoutes,
  logger,
  normalizeScreenName,
  removeLinkingRoute,
  validateLinkingPath,
  wireLinkingIntoGlue,
} from '@armemon-library/cli-kit';
import { managedFile, type AppLayout } from '@armemon-library/config-types';
import {
  ChangeSet,
  applyOutputMode,
  commit,
  emit,
  openApp,
  printChanges,
  printOutcomes,
  realignManaged,
  type ScreenCommandOptions,
} from './screenShared.js';

export interface LinkOptions extends ScreenCommandOptions {
  action: 'init' | 'list' | 'add' | 'remove';
  route?: string;
  /** The URL path, for `add`. */
  linkPath?: string;
}

/**
 * The address a route opens at: the app's first deep-link prefix, then the paths of
 * every entry it is nested under, then its own.
 *
 * Built from the config rather than assumed. This printed `myapp://` for every app,
 * and joined the nesting's route NAMES — neither of which is part of the URL React
 * Navigation actually matches.
 */
function openUrl(content: string, fileName: string, appName: string, nesting: string[], linkPath: string): string {
  const prefix =
    /prefixes\s*:\s*\[\s*['"`]([^'"`]+)['"`]/.exec(activeCodeOf(content, fileName))?.[1] ??
    `${appName.toLowerCase()}://`;

  const routes = linkingRoutes(content, fileName);
  const parents = nesting.map(
    (name, depth) =>
      routes.find(
        (route) => route.routeName === name && route.nesting.join('/') === nesting.slice(0, depth).join('/'),
      )?.path ?? '',
  );

  const pathPart = [...parents, linkPath]
    .map((part) => part.replace(/^\/+|\/+$/g, ''))
    .filter((part) => part.length > 0)
    .join('/');
  // `myapp://` already ends where a path starts; `https://myapp.com` needs a slash.
  const base = prefix.endsWith('://') ? prefix : `${prefix.replace(/\/+$/, '')}/`;
  return `${base}${pathPart}`;
}

export async function runLinkFlow(options: LinkOptions): Promise<void> {
  applyOutputMode(options);

  const { appRoot, config, layout } = await openApp(options);
  const relative = (file: string) => path.relative(appRoot, file).split(path.sep).join('/');

  const navigation = await discoverNavigation(appRoot, { layout });
  const linkingFile = navigation.linkingFile;
  const changes = new ChangeSet(appRoot);

  if (options.action === 'init') {
    await runLinkInit({ appRoot, appName: config.appName, layout, navigation, linkingFile, changes, relative, options });
    return;
  }

  if (!linkingFile) {
    throw new CliError(
      'This app has no deep-linking config, so none of its screens have a URL.',
      'Run "armemon link init" to create one covering every screen this app already has.',
    );
  }

  const content = (await changes.read(linkingFile)) ?? '';

  // ---- list ---------------------------------------------------------------------
  if (options.action === 'list') {
    const routes = linkingRoutes(content, linkingFile);

    if (!options.json) {
      if (routes.length === 0) {
        logger.info(`${relative(linkingFile)} declares no deep links yet.`);
      } else {
        const width = Math.max(...routes.map((route) => route.routeName.length)) + 2;
        for (const route of routes) {
          const where = route.nesting.length > 0 ? `   under ${route.nesting.join(' → ')}` : '';
          // A container has no path of its own, and an empty path is the index route;
          // saying so beats printing nothing.
          const to =
            route.path === null ? '(nests other screens)' : route.path === '' ? '/  (the home page)' : route.path;
          logger.info(`${route.routeName.padEnd(width)}${to}${where}`);
        }
      }
    }

    emit({ ok: true, file: relative(linkingFile), routes }, options);
    return;
  }

  // ---- add / remove -------------------------------------------------------------
  if (!options.route) {
    throw new CliError(
      `Name the route to ${options.action}.`,
      options.action === 'add' ? 'e.g. armemon link add Order order/:id' : 'e.g. armemon link remove Order',
    );
  }
  const routeName = normalizeScreenName(options.route).routeName;

  await realignManaged(changes, layout, [linkingFile]);

  if (options.action === 'remove') {
    const result = await changes.patch(
      linkingFile,
      (current) => removeLinkingRoute(current, { fileName: linkingFile, routeName }),
      { action: `removed the deep link for ${routeName}` },
    );
    if (result.conflict) {
      throw new CliError(`Can't remove ${routeName}'s deep link: ${result.reason}.`, 'Nothing was written.');
    }

    if (options.dryRun) {
      printChanges(changes);
      emit({ ok: true, dryRun: true, route: routeName, removed: result.changed }, options);
      return;
    }

    await commit(changes);
    printOutcomes(changes);
    emit({ ok: result.status !== 'skipped', route: routeName, removed: result.changed }, options);
    return;
  }

  // ---- add ----------------------------------------------------------------------
  const linkPath = options.linkPath;
  if (!linkPath) {
    throw new CliError('Give the path the link should use.', 'e.g. armemon link add Order order/:id');
  }
  const problem = validateLinkingPath(linkPath);
  if (problem) throw new CliError(`"${linkPath}" is not a usable deep-link path.`, problem);

  // Where the route actually lives decides where its entry belongs.
  const owner = navigation.navigators.find((navigator) =>
    navigator.routes.some((route) => route.name === routeName),
  );
  if (owner && owner.nesting === null) {
    throw new CliError(
      `armemon can't tell where <${owner.navigatorTag}> is rendered, so where ${routeName}'s link belongs is unknown.`,
      `Add it by hand: ${routeName}: '${linkPath}',`,
    );
  }
  const nesting = owner?.nesting ?? [];
  if (!owner) {
    logger.warn(`No navigator registers "${routeName}" — adding the link at the root of config.screens.`);
  }

  const result = await changes.patch(
    linkingFile,
    (current) =>
      addLinkingRoute(current, {
        fileName: linkingFile,
        routeName,
        path: linkPath,
        nesting,
        update: { path: true },
      }),
    {
      action:
        nesting.length > 0
          ? `added the deep link ${linkPath} under ${nesting.join(' → ')}`
          : `added the deep link ${linkPath}`,
    },
  );
  if (result.conflict) {
    throw new CliError(`Can't add ${routeName}'s deep link: ${result.reason}.`, 'Nothing was written.');
  }

  if (options.dryRun) {
    printChanges(changes);
    emit({ ok: true, dryRun: true, route: routeName, path: linkPath, nesting }, options);
    return;
  }

  await commit(changes);
  printOutcomes(changes);
  if (result.changed) {
    const written = (await changes.read(linkingFile)) ?? '';
    logger.info(`Opens with: ${openUrl(written, linkingFile, config.appName, nesting, linkPath)}`);
  }

  emit(
    {
      ok: result.status !== 'skipped',
      route: routeName,
      path: linkPath,
      nesting,
      outcomes: changes.outcomes,
    },
    options,
  );
}

interface RouteEntry {
  routeName: string;
  path: string;
  nesting: string[];
}

/**
 * The screens block, nested exactly as the navigators are.
 *
 * Flattening would be simpler and wrong: React Navigation resolves a root-level entry
 * against the root navigator, which has no such route, so a tab screen written flat
 * is a link that opens nothing.
 */
function renderScreens(entries: RouteEntry[], indent: string): string {
  const lines: string[] = [];

  for (const entry of entries.filter((candidate) => candidate.nesting.length === 0)) {
    lines.push(`${indent}${entry.routeName}: '${entry.path}',`);
  }

  const groups = new Map<string, RouteEntry[]>();
  for (const entry of entries.filter((candidate) => candidate.nesting.length > 0)) {
    const [head, ...rest] = entry.nesting;
    const list = groups.get(head!) ?? [];
    list.push({ ...entry, nesting: rest });
    groups.set(head!, list);
  }

  for (const [parent, children] of groups) {
    lines.push(`${indent}${parent}: {`);
    lines.push(`${indent}  screens: {`);
    lines.push(renderScreens(children, `${indent}    `));
    lines.push(`${indent}  },`);
    lines.push(`${indent}},`);
  }

  return lines.join('\n');
}

function buildLinkingConfig(appName: string, entries: RouteEntry[]): string {
  const scheme = appName.toLowerCase();
  const example = entries.find((entry) => entry.path.length > 0)?.path ?? 'Home';
  const indexRoute = entries.find((entry) => entry.path.length === 0);

  return `/**
 * Deep linking — how a URL maps onto a route in RootNavigator.
 *
 * Written by "armemon link init" from the screens this app already had. It is handed
 * straight to <NavigationContainer linking={...}>, and on web it is what gives each
 * screen its own URL: without it every route renders at the bare origin.
 *
 * TEST A LINK WITHOUT LEAVING THE TERMINAL
 *   iOS      npx uri-scheme open "${scheme}://${example}" --ios
 *   Android  npx uri-scheme open "${scheme}://${example}" --android
 *   Web      just visit /${example}
 *
 * Paths match case-sensitively: /${example} and /${example.toLowerCase()} are different links.
 * armemon uses the route name as typed, and "armemon link add <route> <path>" changes
 * any single one.
 */
export const linking = {
  /**
   * Every URL shape that belongs to this app. Add your https origins here for
   * iOS Universal Links / Android App Links. Web ignores this list — the browser's
   * address bar is the source of truth there.
   */
  prefixes: ['${scheme}://'],

  config: {
    screens: {
${renderScreens(entries, '      ')}${
    indexRoute
      ? `

      /**
       * ${indexRoute.routeName} has an empty path, which makes it the index route: "/"
       * opens it. Give it a path of its own if you would rather "/" went elsewhere.
       */`
      : ''
  }
    },
  },
};
`;
}

interface LinkInitContext {
  appRoot: string;
  appName: string;
  layout: AppLayout;
  navigation: Awaited<ReturnType<typeof discoverNavigation>>;
  linkingFile: string | null;
  changes: ChangeSet;
  relative: (file: string) => string;
  options: LinkOptions;
}

/**
 * Creates a linking config for an app that has none, and wires it in.
 *
 * Both halves or neither: a config file nothing imports changes nothing at all, which
 * is the most confusing possible outcome — the paths are right there in the file and
 * the URLs still don't work.
 */
async function runLinkInit(context: LinkInitContext): Promise<void> {
  const { appRoot, appName, layout, navigation, linkingFile, changes, relative, options } = context;

  if (linkingFile) {
    throw new CliError(
      `This app already has a deep-linking config (${relative(linkingFile)}).`,
      'Use "armemon link list" to see it, or "armemon link add <route> <path>" to change one entry.',
    );
  }

  // A route that renders another navigator is a nesting container, not a screen: it
  // gets an entry only as the parent its children sit under.
  const containers = new Set(navigation.navigators.flatMap((navigator) => navigator.nesting ?? []));
  const root = navigation.navigators.find((navigator) => (navigator.nesting ?? []).length === 0);
  const indexRoute = root?.initialRouteName ?? null;

  const entries: RouteEntry[] = [];
  for (const navigator of navigation.navigators) {
    if (navigator.isStatic || navigator.nesting === null) continue;
    for (const route of navigator.routes) {
      if (containers.has(route.name)) continue;
      if (entries.some((entry) => entry.routeName === route.name)) continue;
      entries.push({
        routeName: route.name,
        // The initial route becomes the index route, so "/" is an honest URL too.
        path: route.name === indexRoute ? '' : normalizeScreenName(route.name).linkingPath,
        nesting: navigator.nesting,
      });
    }
  }

  if (entries.length === 0) {
    throw new CliError(
      "This app has no screens armemon can link to.",
      'Add one with "armemon create-screen", then run this again.',
    );
  }

  const configPath = managedFile.linking(layout);
  const gluePath = path.join(appRoot, managedFile.navigationGlue(layout));
  const content = buildLinkingConfig(appName, entries);

  const glue = await changes.patch(
    gluePath,
    (current) => wireLinkingIntoGlue(current, { fileName: gluePath, from: './navigation.config' }),
    { action: 'passed linking into configureNavigationPlugin' },
  );
  if (glue.status === 'skipped') {
    throw new CliError(
      `Can't wire linking into ${relative(gluePath)}: ${glue.reason}.`,
      `Nothing was written. ${glue.manual ?? ''}`.replace(/\s+/g, ' '),
    );
  }

  if (options.dryRun) {
    logger.info(`Would create ${configPath}`);
    printChanges(changes);
    emit({ ok: true, dryRun: true, file: configPath, routes: entries }, options);
    return;
  }

  await commit(changes, { create: [{ path: configPath, content }] });

  logger.success(`Created ${configPath}`);
  printOutcomes(changes);
  for (const entry of entries) {
    const url = [...entry.nesting.map((name) => normalizeScreenName(name).linkingPath), entry.path]
      .filter((part) => part.length > 0)
      .join('/');
    // An empty path is the index route: the app's own address, with nothing after it.
    logger.info(`  /${url}  →  ${entry.routeName}${url.length === 0 ? '  (the home page)' : ''}`);
  }

  emit({ ok: true, file: configPath, routes: entries, outcomes: changes.outcomes }, options);
}
