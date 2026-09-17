/**
 * FILE: managedReadme.test.ts
 * PATH: packages/cli-kit/test/managedReadme.test.ts
 *
 * WHAT: The guide written into every scaffolded app.
 * WHY:  Its readers are often new to armemon, so the things it must not get wrong are
 *       the folder names (an app scaffolded before the managed zone moved keeps it under
 *       src/, and a guide naming the wrong folder is worse than none), the one rule
 *       about who edits what, and the standalone setup — whose most likely failure, a
 *       missing NetInfo adapter, is a startup crash.
 *
 *       Whether every command in it actually runs is checked in cli-armemon, against
 *       the real command definitions.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, LEGACY_LAYOUT, javaScriptSyntaxErrors, managedReadme } from '../dist/index.js';

const guide = managedReadme(DEFAULT_LAYOUT);

describe('managedReadme', () => {
  it('names the folder the settings live in', () => {
    expect(guide).toContain('| `armemon/` |');
    expect(guide).toContain('armemon/ui/theme.config.ts');
  });

  it('names the legacy folder in an app that still has one', () => {
    const legacy = managedReadme(LEGACY_LAYOUT);
    expect(legacy).toContain('| `src/armemon/` |');
    expect(legacy).toContain('src/armemon/ui/theme.config.ts');
    expect(legacy).not.toContain('| `armemon/` |');
  });

  it('states the one rule about who changes what', () => {
    expect(guide).toMatch(/One simple rule/);
    expect(guide).toMatch(/never touches them again/);
    for (const folder of ['src/screens/', 'src/shared/', 'src/store/slices/']) {
      expect(guide).toContain(folder);
    }
  });

  it('tells a beginner what to do when the command is not found', () => {
    expect(guide).toContain('npm install -g @armemon-library/cli');
    expect(guide).toContain('npx @armemon-library/cli doctor');
  });

  it('says what to run after editing by hand, and that this file is rewritten', () => {
    expect(guide).toContain('armemon sync');
    expect(guide).toMatch(/rewrites completely is this\s+guide/);
  });

  it('covers every plugin', () => {
    for (const plugin of ['@armemon-library/ui', '@armemon-library/redux', '@armemon-library/navigation', '@armemon-library/essentials']) {
      expect(guide).toContain(plugin);
    }
    expect(guide).toMatch(/Splash/);
  });

  describe('using the plugins without the CLI', () => {
    it('installs core and wires it through registerRuntimeConfig and KitProvider', () => {
      expect(guide).toContain('npm install @armemon-library/core');
      expect(guide).toContain('registerRuntimeConfig(');
      expect(guide).toContain('<KitProvider>');
    });

    /**
     * Essentials starts with no arguments, and needs the optional NetInfo package only
     * when you ask for network status — so the simplest setup is the one that runs.
     */
    it('starts Essentials with no arguments, and shows how to add network status', () => {
      expect(guide).toContain('configureEssentialsPlugin(),');
      expect(guide).toContain("import { netInfoAdapter } from '@armemon-library/essentials/netinfo';");
      expect(guide).toContain('configureEssentialsPlugin({ netInfoAdapter })');
    });

    it('marks the NetInfo package as optional', () => {
      expect(guide).toMatch(/network status \(optional\)\nnpm install @react-native-community\/netinfo/);
    });

    it('marks the optional Redux packages as optional', () => {
      expect(guide).toMatch(/optional\)\nnpm install redux-persist @react-native-async-storage\/async-storage/);
    });

    it('explains the error a beginner is most likely to hit', () => {
      expect(guide).toContain('No armemon runtime config registered');
    });
  });

  /** The two that deliberately do not touch it — worth saying, since every other does. */
  it('says which commands leave the settings folder alone', () => {
    expect(guide).toMatch(/create-component.*create-hook/s);
  });
});

/**
 * The copy written into an app describes that app. It used to describe every plugin
 * whatever the app had, and show TypeScript to JavaScript apps — so a reader was
 * pointed at Redux in an app without it, and pasted `(state: any) =>` into a .js file.
 */
describe('managedReadme for a specific app', () => {
  it('leaves out what the app does not have', () => {
    const app = managedReadme(DEFAULT_LAYOUT, { plugins: ['ui'], language: 'typescript' });

    expect(app).toContain('### UI — theme, text and buttons');
    for (const absent of ['### Redux — app state', 'armemon create-slice', '### Navigation', 'armemon link init', '### Essentials', '### Splash', 'src/store/slices/']) {
      expect(app, absent).not.toContain(absent);
    }
    expect(app).not.toContain('essentials.notifications.position');
  });

  it('keeps everything for an app that has it all', () => {
    const app = managedReadme(DEFAULT_LAYOUT, {
      plugins: ['ui', 'redux', 'navigation', 'essentials', 'splash'],
      language: 'typescript',
    });
    for (const present of ['### Redux — app state', 'armemon create-slice', '### Navigation', 'armemon link init', '### Essentials', '### Splash']) {
      expect(app, present).toContain(present);
    }
  });

  it('writes a JavaScript app its own file names and untyped snippets', () => {
    const app = managedReadme(DEFAULT_LAYOUT, {
      plugins: ['ui', 'redux', 'essentials', 'splash'],
      language: 'javascript',
    });

    expect(app).toContain('armemon/ui/theme.config.js');
    expect(app).toContain('// armemon.setup.js');
    expect(app).toContain('// App.jsx');
    expect(app).toContain('useSelector((state) => state.cart.value)');
    expect(app).not.toMatch(/\.tsx?\b/);
    expect(app).not.toContain('```tsx');
    expect(app).not.toContain(': any');
  });

  it('gives a JavaScript app code blocks that are JavaScript', () => {
    const app = managedReadme(DEFAULT_LAYOUT, {
      plugins: ['ui', 'redux', 'navigation', 'essentials', 'splash'],
      language: 'javascript',
    });
    const blocks = [...app.matchAll(/^```(js|jsx)\n([\s\S]*?)^```$/gm)];
    expect(blocks.length).toBeGreaterThan(3);
    for (const [, language, code] of blocks) {
      expect(javaScriptSyntaxErrors(code!, `block.${language}`), code).toEqual([]);
    }
  });

  it('says so when the app has no plugins, and still explains how to add them', () => {
    const app = managedReadme(DEFAULT_LAYOUT, { plugins: [], language: 'typescript' });
    expect(app).toContain('This app uses no plugins yet.');
    expect(app).toContain('armemon plugin add redux');
    expect(app).toContain('## Use the plugins without the armemon CLI');
    expect(app).not.toContain('### Change a setting');
  });

  it('is unchanged for the full guide the repository publishes', () => {
    expect(managedReadme(DEFAULT_LAYOUT)).toContain('Your app may use some or all of them.');
  });
});
