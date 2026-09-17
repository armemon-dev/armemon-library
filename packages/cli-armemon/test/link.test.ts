/**
 * FILE: link.test.ts
 * PATH: packages/cli-armemon/test/link.test.ts
 *
 * WHAT: `armemon link list|add|remove` against a real app.
 * WHY:  Deep links have no compile-time feedback: a wrong entry opens nothing, and
 *       says nothing. The case that matters most is nesting — a link added flat for a
 *       screen inside a tab navigator resolves against the root navigator, which has
 *       no such route, so it is silently dead. `add` has to nest it, and `list` has to
 *       show where each one sits or it cannot be used to check the config.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { linkingRoutes } from '@armemon-library/cli-kit';
import { runCreateScreenFlow, runLinkFlow } from '../dist/index.js';
import {
  NAV,
  captureStdout,
  makeApp,
  resetCliState,
  scaffoldNavigation,
  writeConfig,
  type TestApp,
} from './support/screenApps';

const CONFIG = `${NAV}/navigation.config.ts`;

/**
 * Read through the parser, never by searching the text.
 *
 * The generated linking config documents itself with examples that are
 * character-for-character what real entries look like — `screens: { Home: 'Home',
 * Settings: 'Settings' }` sits in a comment block in every one of these files. A
 * text search finds entries that are not there and misses ones that are, which is
 * the whole reason linkingRoutes exists.
 */
const routes = async () => linkingRoutes(await app.read(CONFIG), CONFIG);

let app: TestApp;

beforeEach(async () => {
  app = await makeApp();
  resetCliState();
});
afterEach(async () => {
  await app.remove();
  resetCliState();
});

const link = (options: Record<string, unknown>) =>
  runLinkFlow({ cwd: app.root, allAccept: true, verify: false, action: 'list', ...options } as never);

describe('link list', () => {
  it('reports every declared link', async () => {
    await scaffoldNavigation(app);
    const json = await captureStdout(() => link({ action: 'list', json: true }));
    const { routes } = JSON.parse(json);

    expect(routes.map((route: { routeName: string }) => route.routeName)).toContain('Home');
  });

  it('says where a nested link sits', async () => {
    await scaffoldNavigation(app, { navigatorType: 'stack-with-tabs' });
    const json = await captureStdout(() => link({ action: 'list', json: true }));
    const { routes } = JSON.parse(json);

    const home = routes.find((route: { routeName: string }) => route.routeName === 'Home');
    expect(home.nesting).toEqual(['Tabs']);
  });

  it('refuses in an app with no deep-linking config', async () => {
    await writeConfig(app);
    await expect(link({ action: 'list' })).rejects.toMatchObject({
      message: expect.stringContaining('no deep-linking config'),
    });
  });
});

describe('link add', () => {
  it('adds a link for a route at the root', async () => {
    await scaffoldNavigation(app);
    await runCreateScreenFlow({ cwd: app.root, allAccept: true, verify: false, name: 'Order', noLink: true });

    await link({ action: 'add', route: 'Order', linkPath: 'order/:id' });

    expect(await routes()).toContainEqual({ routeName: 'Order', path: 'order/:id', nesting: [] });
  });

  /** The bug this command exists to prevent. */
  it('nests a link for a screen inside a tab navigator', async () => {
    await scaffoldNavigation(app, { navigatorType: 'stack-with-tabs' });
    await runCreateScreenFlow({
      cwd: app.root,
      allAccept: true,
      verify: false,
      name: 'Order',
      navigator: 'Tab',
      noLink: true,
    });

    const json = await captureStdout(() =>
      link({ action: 'add', route: 'Order', linkPath: 'order', json: true }),
    );

    expect(JSON.parse(json).nesting).toEqual(['Tabs']);
    // Written under Tabs, not at the root — which is the difference between a link
    // that opens the screen and one that resolves to nothing.
    expect(await routes()).toContainEqual({ routeName: 'Order', path: 'order', nesting: ['Tabs'] });
  });

  it('updates the path of a link that already exists', async () => {
    await scaffoldNavigation(app);
    await link({ action: 'add', route: 'Home', linkPath: 'start' });

    expect(await routes()).toContainEqual({ routeName: 'Home', path: 'start', nesting: [] });
  });

  it('refuses a path a URL could not carry', async () => {
    await scaffoldNavigation(app);
    await expect(link({ action: 'add', route: 'Home', linkPath: 'has spaces' })).rejects.toMatchObject({
      message: expect.stringContaining('not a usable deep-link path'),
    });
  });

  it('needs a path', async () => {
    await scaffoldNavigation(app);
    await expect(link({ action: 'add', route: 'Home' })).rejects.toMatchObject({
      message: expect.stringContaining('Give the path'),
    });
  });

  it('--dry-run writes nothing', async () => {
    await scaffoldNavigation(app);
    const before = await app.read(CONFIG);

    await link({ action: 'add', route: 'Home', linkPath: 'start', dryRun: true });

    expect(await app.read(CONFIG)).toBe(before);
  });
});

describe('link remove', () => {
  it('removes a link', async () => {
    await scaffoldNavigation(app);
    await link({ action: 'remove', route: 'Home' });

    expect((await routes()).map((route) => route.routeName)).not.toContain('Home');
  });

  it('reports a link that was never there rather than failing', async () => {
    await scaffoldNavigation(app);
    const json = await captureStdout(() => link({ action: 'remove', route: 'Nothing', json: true }));

    expect(JSON.parse(json)).toMatchObject({ ok: true, removed: false });
  });

  it('--dry-run writes nothing', async () => {
    await scaffoldNavigation(app);
    const before = await app.read(CONFIG);

    await link({ action: 'remove', route: 'Home', dryRun: true });

    expect(await app.read(CONFIG)).toBe(before);
  });
});

/** The status lines a person reads — logger.info goes through console.log. */
async function captureLog(run: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  });
  try {
    await run();
  } finally {
    spy.mockRestore();
  }
  return lines.join('\n');
}

describe('what link tells you', () => {
  // It printed `myapp://` for every app, and built nested URLs from route NAMES —
  // an address React Navigation would never match.
  it('prints the address a new link really opens, with the app’s own scheme', async () => {
    await scaffoldNavigation(app);
    const out = await captureLog(() => link({ action: 'add', route: 'Screen2', linkPath: 'order/:id' }));
    expect(out).toContain('Opens with: myapp://order/:id');
  });

  it('builds a nested address from the parent entries’ paths, not their names', async () => {
    await scaffoldNavigation(app, { navigatorType: 'stack-with-tabs' });
    const out = await captureLog(() => link({ action: 'add', route: 'Screen2', linkPath: 'feed' }));
    const url = /Opens with: (\S+)/.exec(out)?.[1];
    expect(url).toBeDefined();
    expect(url).not.toContain('Tabs');
    expect(url!.endsWith('feed')).toBe(true);
  });

  it('labels the index route instead of printing an empty path', async () => {
    await scaffoldNavigation(app, { enableDeepLinking: false });
    const init = await captureLog(() => link({ action: 'init' }));
    expect(init).toMatch(/\/ {2}→ {2}Home {2}\(the home page\)/);

    const list = await captureLog(() => link({ action: 'list' }));
    expect(list).toContain('(the home page)');
  });
});

describe('link init', () => {
  /**
   * The repair for an app scaffolded without deep linking — which, before this, was
   * every app that took the default. The symptom it fixes is that every screen
   * renders at the bare origin on web.
   */
  it('creates a config covering every screen, and wires it into the glue', async () => {
    await scaffoldNavigation(app, { enableDeepLinking: false });
    expect(await app.exists(CONFIG)).toBe(false);

    await link({ action: 'init' });

    expect(await app.exists(CONFIG)).toBe(true);
    const names = (await routes()).map((route) => route.routeName);
    expect(names).toContain('Home');
    expect(names).toContain('Screen2');

    // A config nothing imports changes nothing: the glue has to pass it through.
    const glue = await app.read(`${NAV}/index.ts`);
    expect(glue).toContain("import { linking } from './navigation.config';");
    expect(glue).toContain('configureNavigationPlugin({ linking })');
  });

  it('makes the initial route the index route, so "/" is a real URL too', async () => {
    await scaffoldNavigation(app, { enableDeepLinking: false });
    await link({ action: 'init' });

    expect(await routes()).toContainEqual({ routeName: 'Home', path: '', nesting: [] });
  });

  it('nests a tab screen under its navigator rather than writing it flat', async () => {
    await scaffoldNavigation(app, { navigatorType: 'stack-with-tabs', enableDeepLinking: false });
    await link({ action: 'init' });

    const feed = (await routes()).find((route) => route.routeName === 'Screen2');
    expect(feed?.nesting).toEqual(['Tabs']);
  });

  it('refuses when the app already has a config', async () => {
    await scaffoldNavigation(app);
    await expect(link({ action: 'init' })).rejects.toMatchObject({
      message: expect.stringContaining('already has a deep-linking config'),
    });
  });

  it('--dry-run writes nothing', async () => {
    await scaffoldNavigation(app, { enableDeepLinking: false });
    await link({ action: 'init', dryRun: true });

    expect(await app.exists(CONFIG)).toBe(false);
    expect(await app.read(`${NAV}/index.ts`)).not.toContain('navigation.config');
  });

  it('reports the routes it linked as JSON', async () => {
    await scaffoldNavigation(app, { enableDeepLinking: false });
    const json = await captureStdout(() => link({ action: 'init', json: true }));

    const summary = JSON.parse(json);
    expect(summary.ok).toBe(true);
    expect(summary.file).toBe(CONFIG);
    expect(summary.routes.map((route: { routeName: string }) => route.routeName)).toContain('Home');
  });
});
