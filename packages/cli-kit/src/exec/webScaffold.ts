/**
 * FILE: webScaffold.ts
 * PATH: packages/cli-kit/src/exec/webScaffold.ts
 *
 * WHAT: Generates the Web target's files — no shell-out, since (unlike
 *       iOS/Android/Windows/macOS) there's no official "attach a web build to my RN
 *       app" CLI tool. Web has zero shared tooling with the native platforms at all:
 *       Metro can't bundle for browsers, so Web needs its own build pipeline
 *       (Vite + react-native-web) entirely, coexisting in the same repo/package.json
 *       rather than sharing Metro config with the native targets.
 * WHY:  A manual Vite config (alias react-native→react-native-web, add
 *       .web.tsx/.web.ts/.web.jsx/.web.js resolve extensions before the bare ones,
 *       define __DEV__ since Vite doesn't inject RN's __DEV__ global the way Metro
 *       does) was chosen over a third-party vite-plugin-react-native-web package —
 *       one fewer unpublished-ecosystem dependency of unverified maintenance status,
 *       and the manual approach is fully specified by this file alone. The
 *       react-native→react-native-web alias MUST be an exact-match RegExp
 *       (`^react-native$`), not a plain string — confirmed live: a plain string alias
 *       does a prefix rewrite, so libraries that deep-import RN internals (e.g.
 *       react-native-safe-area-context's
 *       `react-native/Libraries/Utilities/codegenNativeComponent`, used only for
 *       native Fabric codegen registration) got corrupted into
 *       `react-native-web/Libraries/Utilities/codegenNativeComponent`, a path that
 *       doesn't exist in react-native-web's package layout at all, crashing esbuild
 *       outright. An exact-match alias leaves those deep imports to resolve against
 *       the real, installed react-native package (present anyway for the native
 *       targets), which is what upstream RNW+bundler setups (Webpack's
 *       `react-native$` convention) do for the same reason. react-dom MUST
 *       be pinned to the exact same version as the app's own "react" (React ships
 *       react/react-dom in lockstep with identical version numbers; a mismatched
 *       major breaks at runtime, not just a peer-dep warning) — confirmed live: with
 *       rnVersion "latest" the RN CLI's template pinned react to 19.2.3 while this
 *       file had react-dom hardcoded to 18.3.1, producing exactly that mismatch. The
 *       caller reads the already-scaffolded app's actual react version and passes it
 *       in rather than this file guessing, since "latest" makes the react version
 *       unknowable in advance.
 * HOW:  index.web.tsx mirrors the RN CLI's own index.js pattern exactly
 *       (AppRegistry.registerComponent + runApplication, reading the same app.json
 *       "name" field) rather than a bespoke react-dom render call — keeps the web
 *       entry point consistent with the native entry point's own convention, and
 *       lets react-native-web's own AppRegistry implementation own the DOM mount.
 * WHEN: Called once, if 'web' is in the selected platforms, after platform cleanup
 *       and before plugin wizards — returns a plan-shaped object the flow merges
 *       into its overall dependency/file collections directly (this doesn't go
 *       through the plugin wizard pipeline, so it's not a PluginInstallPlan, just
 *       the same {npmDependencies, filesToWrite} shape for consistency).
 *
 * EXPORTS: buildWebScaffoldPlan, ignoreWebBuildOutput, WebScaffoldPlan, viteAliasEntry,
 *          viteEnvModuleCall, ENV_MODULE_PLUGIN
 * DEPENDS ON: node:fs/promises, node:module, node:path, typescript,
 *             @armemon-library/config-types (types only)
 * USED BY: packages/cli-armemon/src/flows/initReactNative.ts
 */

import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import type { WebContributions } from '@armemon-library/config-types';

/**
 * Keeps the web build's output out of the tools that read the app's source.
 *
 * React Native's tsconfig type-checks JavaScript and excludes only Pods, so after a
 * `web:build` the minified bundle in web/dist was part of the program — and a
 * function it declares named `it` shadowed Jest's, failing `tsc` on the app's own
 * test. `eslint .` reported tens of thousands of problems in the same file.
 *
 * tsconfig gets the exclude it inherits plus web/dist, since setting `exclude`
 * replaces the inherited list rather than adding to it. ESLint gets a .eslintignore
 * line, which the legacy config React Native's template uses reads; an app on a flat
 * config (eslint.config.*) is left to its owner.
 */
export async function ignoreWebBuildOutput(appRoot: string): Promise<void> {
  const tsconfigPath = path.join(appRoot, 'tsconfig.json');
  const tsconfigText = await fs.readFile(tsconfigPath, 'utf8').catch(() => null);
  if (tsconfigText !== null) {
    const tsconfig = (ts.parseConfigFileTextToJson(tsconfigPath, tsconfigText).config ?? {}) as {
      extends?: string;
      exclude?: string[];
    };
    let exclude = tsconfig.exclude;
    if (!exclude && typeof tsconfig.extends === 'string') {
      try {
        const basePath = createRequire(tsconfigPath).resolve(tsconfig.extends);
        const base = ts.parseConfigFileTextToJson(basePath, await fs.readFile(basePath, 'utf8')).config as {
          exclude?: string[];
        };
        exclude = base?.exclude;
      } catch {
        // The base can't be read; TypeScript's own default is what applies then.
      }
    }
    exclude = exclude ?? ['node_modules'];
    if (!exclude.includes('web/dist')) {
      tsconfig.exclude = [...exclude, 'web/dist'];
      await fs.writeFile(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`, 'utf8');
    }
  }

  const hasLegacyEslint = (await fs.readdir(appRoot).catch(() => [] as string[])).some((name) =>
    /^\.eslintrc(\.(js|cjs|json|ya?ml))?$/.test(name),
  );
  if (hasLegacyEslint) {
    const ignorePath = path.join(appRoot, '.eslintignore');
    const existing = await fs.readFile(ignorePath, 'utf8').catch(() => '');
    if (!existing.split('\n').some((line) => line.trim().replace(/\/$/, '') === 'web/dist')) {
      const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
      await fs.writeFile(ignorePath, `${existing}${separator}web/dist/\n`, 'utf8');
    }
  }
}

export interface WebScaffoldPlan {
  npmDependencies: Record<string, string>;
  filesToWrite: Array<{ path: string; content: string }>;
}

/** A string as a single-quoted source literal, the style the rest of the config uses. */
const quote = (text: string): string => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** A string as a regular-expression literal's source, matching itself exactly. */
const regexSource = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * `resolve.alias` entries for plugin aliases, as source text.
 *
 * A RegExp that stops at a `/` or the end, never a plain string: a string alias is a
 * prefix rewrite, so `'@'` would also rewrite `@react-navigation/native`.
 */
function aliasEntries(aliases: Record<string, string>): string {
  return Object.entries(aliases)
    .map(([name, target]) => {
      const entry = viteAliasEntry(name, target);
      return `      ${entry.comment}\n      ${entry.code},`;
    })
    .join('\n');
}

/** One `resolve.alias` entry and the comment above it, as the config writes them. */
export function viteAliasEntry(name: string, target: string): { comment: string; code: string; find: string } {
  const find = `/^${regexSource(name)}(?=\\/|$)/`;
  return {
    comment: `// ${name}/… → ${target}/…, the alias Babel's module-resolver gives Metro.`,
    code: `{ find: ${find}, replacement: path.join(appRoot, ${quote(target)}) }`,
    find,
  };
}

/** The `plugins` entry that serves one env file as a module. */
export function viteEnvModuleCall(name: string, file: string): string {
  return `envModule(${quote(name)}, path.join(appRoot, ${quote(file)}))`;
}

/**
 * The Vite plugin that serves an env file as a module, as source text.
 *
 * Metro gets `import { API_URL } from '@env'` from react-native-dotenv, a Babel
 * plugin; Vite's React plugin doesn't run the app's Babel config, so on web the
 * import failed the build. This reads the same file at build time — the values are
 * compiled in, exactly as Babel does — and only the variables written in it, never
 * the rest of process.env.
 */
export const ENV_MODULE_PLUGIN = `
// Serves an env file as a module, the way react-native-dotenv does for Metro — see
// webScaffold.ts. Values are read at build time: restart Vite after editing the file.
function envModule(name: string, file: string): Plugin {
  const id = '\\0' + name;
  return {
    name: 'armemon-env:' + name,
    resolveId: (source) => (source === name ? id : null),
    load(resolved) {
      if (resolved !== id) return null;
      this.addWatchFile(file);
      const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      const lines: string[] = [];
      for (const line of text.split(/\\r?\\n/)) {
        const match = /^\\s*(?:export\\s+)?([A-Za-z_][A-Za-z0-9_]*)\\s*=(.*)$/.exec(line);
        if (!match) continue;
        let value = (match[2] ?? '').trim();
        const quoted = /^(['"])([\\s\\S]*)\\1$/.exec(value);
        value = quoted ? (quoted[2] ?? '') : value.replace(/\\s+#.*$/, '');
        lines.push('export const ' + match[1] + ' = ' + JSON.stringify(value) + ';');
      }
      return lines.join('\\n');
    },
  };
}
`;

/**
 * react-native-web's React peer range, by the app's actual React major.
 *
 * A hardcoded '^0.19.13' broke the web target outright on current React Native:
 * 0.19.x peers on `react@^18.0.0`, React Native 0.87 installs React 19, and npm
 * refuses the tree with ERESOLVE before a single file is written. Verified against
 * the registry — 0.20.0 is the first release whose peer range is
 * `^18.0.0 || ^19.0.0`.
 */
function reactNativeWebVersion(reactVersion: string): string {
  const major = Number.parseInt(reactVersion.replace(/^[^\d]*/, '').split('.')[0] ?? '', 10);
  if (Number.isNaN(major)) return '^0.20.0'; // "latest" or unparseable: take the broader peer.
  return major >= 19 ? '^0.20.0' : '^0.19.13';
}

export function buildWebScaffoldPlan(
  reactVersion: string,
  dedupePackages: string[] = [],
  contributions: WebContributions[] = [],
): WebScaffoldPlan {
  const aliases = Object.assign({}, ...contributions.map((entry) => entry.aliases ?? {})) as Record<
    string,
    string
  >;
  const envModules = Object.assign({}, ...contributions.map((entry) => entry.envModules ?? {})) as Record<
    string,
    string
  >;
  const hasEnvModules = Object.keys(envModules).length > 0;
  const plugins = [
    'react()',
    ...Object.entries(envModules).map(([name, file]) => viteEnvModuleCall(name, file)),
  ];

  return {
    npmDependencies: {
      'react-native-web': reactNativeWebVersion(reactVersion),
      'react-dom': reactVersion,
      vite: '^6.0.0',
      '@vitejs/plugin-react': '^4.3.4',
    },
    filesToWrite: [
      {
        // Inside web/, so Vite infers its project root from the config's own
        // directory — no `root` option needed, and everything web-related lives
        // together the way android/ and ios/ do.
        path: 'web/vite.config.ts',
        content: `import { defineConfig${hasEnvModules ? ', type Plugin' : ''} } from 'vite';
import react from '@vitejs/plugin-react';
${hasEnvModules ? "import fs from 'node:fs';\n" : ''}import { createRequire } from 'node:module';
import path from 'node:path';

// Manual react-native-web wiring — see webScaffold.ts for why this isn't a
// third-party vite-plugin-react-native-web dependency.
//
// Resolved from the project root rather than from import.meta.url: the app's
// TypeScript config is React Native's, whose \`module\` setting doesn't permit
// import.meta (TS1343), and this file is inside the app's tsconfig scope. Vite is
// always run from the app root, so this resolves identically.
const require = createRequire(path.join(process.cwd(), 'noop.js'));
const appRoot = path.resolve(__dirname, '..');
${hasEnvModules ? ENV_MODULE_PLUGIN : ''}
export default defineConfig(({ mode }) => ({
  // This folder is the web project: index.html, the entry, and public/ are all
  // here, and \`dist\` below is resolved against it.
  //
  // public/ is for static files served from the site root as they are — put
  // logo.png there and it is at /logo.png. Everything in it is copied into dist/
  // and deployed, so keep notes and anything private out of it.
  root: __dirname,
  plugins: [${plugins.join(', ')}],
  resolve: {
    // Exact-match only (not a prefix rewrite) — deep imports into react-native's
    // internals (e.g. react-native-safe-area-context's own Fabric codegen spec
    // files) must resolve against the real react-native package, not get rewritten
    // into a react-native-web path that doesn't exist. See webScaffold.ts header.
    alias: [
      { find: /^react-native$/, replacement: require.resolve('react-native-web') },
${Object.keys(aliases).length > 0 ? `${aliasEntries(aliases)}\n` : ''}    ],
    // Vite's equivalent of metro.config.js's extraNodeModules proxy. @armemon-library/*
    // packages are installed as file: links, so an import made from inside one
    // resolves against the LINK TARGET's node_modules, not this app's — and a
    // second copy of any context-based library silently breaks it. Confirmed the
    // hard way: two copies of @react-navigation/native produced "Couldn't register
    // the navigator. Have you wrapped your app with 'NavigationContainer'?" on a
    // web build that bundled without a single warning. dedupe forces one copy.
    dedupe: [
${dedupePackages.map((name) => `      '${name}',`).join('\n')}
    ],
    extensions: ['.web.tsx', '.web.ts', '.web.jsx', '.web.js', '.tsx', '.ts', '.jsx', '.js', '.json'],
  },
  define: {
    global: 'window',
    __DEV__: JSON.stringify(mode !== 'production'),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    // App.tsx and src/ live one level up, outside this Vite root.
    fs: { allow: [appRoot] },
  },
  // esbuild's dependency pre-bundler (dev server only — \`vite build\`'s Rollup
  // resolver already respects resolve.extensions on its own) does NOT inherit
  // resolve.extensions automatically. Without this, "vite" (dev) resolves
  // packages' platform-suffixed files (e.g. SafeAreaView.js instead of
  // SafeAreaView.web.js) to their NATIVE variant, which can pull in Flow-syntax
  // React Native internals esbuild can't parse.
  optimizeDeps: {
    esbuildOptions: {
      resolveExtensions: ['.web.tsx', '.web.ts', '.web.jsx', '.web.js', '.tsx', '.ts', '.jsx', '.js', '.json'],
    },
  },
}));
`,
      },
      {
        path: 'web/index.tsx',
        content: `import { AppRegistry } from 'react-native';
import App from '../App';
import { name as appName } from '../app.json';

// The RN tsconfig's \`lib\` has no DOM, so \`document\` is otherwise an unresolved
// name here (TS2584); this file is the only one that needs it.
declare const document: { getElementById(id: string): unknown };

const rootTag = document.getElementById('root');
if (!rootTag) {
  throw new Error('web/index.html is missing its <div id="root"> mount point.');
}

// react-native-web mounts into a DOM element, but React Native's own typings
// describe rootTag for the native renderer — a plain number in older releases, an
// opaque \`RootTag\` symbol type since 0.87. Neither accepts an HTMLElement, and the
// web renderer's real contract isn't expressible in those types. Deriving the
// expected type from AppRegistry itself keeps this correct across RN versions.
type RootTagType = Parameters<typeof AppRegistry.runApplication>[1]['rootTag'];

// Mirrors index.js's native entry exactly — react-native-web's own AppRegistry
// implementation owns the DOM mount. \`initialProps\` is required by AppParameters.
AppRegistry.registerComponent(appName, () => App);
AppRegistry.runApplication(appName, {
  rootTag: rootTag as unknown as RootTagType,
  initialProps: {},
});
`,
      },
      {
        path: 'web/index.html',
        content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>App</title>
    <style>
      /* react-native-web doesn't inject this itself — without it, html/body/#root
         all collapse to height:0 (RN's flex:1 layouts have nothing to size
         against) and text falls back to the browser's serif default. This is the
         standard root-level reset react-native-web's own docs call out as the
         app's responsibility. */
      html, body, #root {
        height: 100%;
      }
      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      }
      #root {
        display: flex;
        flex-direction: column;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/index.tsx"></script>
  </body>
</html>
`,
      },
    ],
  };
}
