# Writing an armemon plugin

An armemon plugin is an ordinary npm package. Nothing about it is registered in the
CLI: it is discovered from its own `package.json`, and the CLI resolves it from your
project as well as from its own install, so a plugin you publish (or keep private in
your repo) works the same way the built-in ones do.

A plugin has three parts.

## 1. The manifest

An `armemon` object in `package.json`. This is what discovery reads, before anything
is installed or imported.

```jsonc
{
  "name": "@acme/armemon-plugin-analytics",
  "armemon": {
    "manifestVersion": 1,
    "pluginId": "analytics",
    "displayName": "Analytics",
    "description": "Session tracking, wired at startup.",
    "category": "observability",
    "required": false,
    "runtimeExportName": "AnalyticsPlugin",
    "peerPackages": ["@acme/analytics-sdk"],

    // Optional. Omit for "works everywhere". A plugin listing only native
    // platforms is hidden from the catalog when none of them are selected.
    "platforms": ["ios", "android"],

    // Optional. pluginIds whose wizard must run before yours, because you read
    // their answers from ctx.alreadyAnsweredByOtherPlugins. The CLI sorts
    // topologically — never rely on catalog order.
    "dependsOn": ["redux"]
  }
}
```

`runtimeExportName` is explicit rather than derived from `pluginId`. Guessing export
names by string-munging was a real source of silent codegen failures in the CLI this
replaced.

## 2. The wizard (`./wizard` export, Node-only)

Default-export a `PluginWizard`. `run()` asks questions; `plan()` is **pure** and
describes what should happen. Splitting them is what lets the CLI collect every
plugin's plan before writing anything, so a cancelled or failed wizard never leaves
half an app behind.

```ts
import { layoutOf, managedPath, type PluginWizard } from '@armemon-library/config-types';
import { promptConfirm, resolveDependencyVersions } from '@armemon-library/cli-kit';

interface Answers { trackScreens: boolean; versions: Record<string, string> }

const wizard: PluginWizard<Answers> = {
  pluginId: 'analytics',
  intro: 'Analytics — session and screen tracking.',

  async run(ctx) {
    const trackScreens = await promptConfirm({
      message: 'Track screen views automatically?',
      initialValue: true,
    });
    const versions = await resolveDependencyVersions(ctx.rnVersion, [
      { packageName: '@acme/analytics-sdk' },
    ]);
    return { trackScreens, versions };
  },

  async plan(answers, ctx) {
    return {
      npmDependencies: answers.versions,
      filesToWrite: [
        {
          path: managedPath(layoutOf(ctx), 'analytics', 'index.ts'),
          content: `import { configureAnalyticsPlugin } from '@acme/armemon-plugin-analytics';\n\nexport const AnalyticsPlugin = configureAnalyticsPlugin({ trackScreens: ${answers.trackScreens} });\n`,
        },
      ],
      appEntryContributions: {
        providerImport: { importName: 'AnalyticsPlugin', from: './analytics/index' },
        registerInRuntimeConfig: true,
      },
    };
  },
};

export default wizard;
```

### What a plan can contribute

| Field | Use it for |
| --- | --- |
| `npmDependencies` | Runtime packages |
| `devDependencies` | Babel plugins, type stubs, lint configs — anything build-time |
| `filesToWrite` | Generated source, relative to the app root |
| `babelPlugins` | Entries merged into one composed `babel.config.js` |
| `filesToCopy` | Binary files copied into the app — images, fonts |
| `htmlContributions` | Markup for the web target's `index.html` that must paint before the bundle loads, such as a splash |
| `webContributions` | What the web target's Vite config needs to match your Babel entries: `aliases` (`{ '@': 'src' }`) and `envModules` (`{ '@env': '.env' }`). Vite doesn't run `babel.config.js`, so anything that works through Babel breaks only on web unless you say it again here |
| `entryPrelude` | Lines prepended to `index.js` (side-effect imports that must be first) |
| `gitignoreEntries` | Files your plugin teaches the app to create |
| `jsonMerges` | Keys merged into a JSON file the app already has: `{ path: 'tsconfig.json', values: { compilerOptions: { paths: { '@/*': ['./src/*'] } } } }`. Only those keys are touched, and `plugin remove` takes them back out — prefer it to writing the whole file |
| `packageJsonScripts` | Launcher or tooling scripts |
| `appEntryContributions` | The runtime export to register |
| `provides` | What your output lets the CLI build on: `'app-root'` if you write the navigator the App entry renders (`navigation/RootNavigator` in the managed zone), `'themed-components'` if the app can render `@armemon-library/ui`'s components and has its `UiKitScreen` example |
| `runtimeConfigContributions` | Values for `@armemon-library/core`'s RuntimeConfig |
| `postInstallSteps` | Real work that needs the dependencies installed first |
| `postInstallNotes` | Only what genuinely cannot be automated |
| `nativeReferences` | `{ marker, package }` pairs: text that, found in android/ or ios/, means native code still needs one of your packages — `{ marker: 'Theme.BootSplash', package: 'react-native-bootsplash' }`. `plugin remove` stops while a marker is there instead of uninstalling a package the native build needs |
| `removalNotes` | What `armemon plugin remove` can't take back out, said to the person removing your plugin — a secret in a file the app now owns, images a native tool generated |

Prefer any of the fields above over a note. A note is a task you handed back to the
user; the whole point of the tool is not to.

`plan()` may **read** the filesystem — merging into a file the RN CLI generated
requires knowing what's in it — but must not write. Anything with a side effect
belongs in `postInstallSteps`, which run after the batched install.

### Plans must be deterministic

`armemon plugin add` and `plugin remove` run your `plan()` again, later, with the
answers `armemon.config` recorded, and compare what it returns with what is in the app.
That is how they know which files are still yours to delete and which the user has
changed. So for the same answers and the same app, `plan()` must return the same plan:
no timestamps, no random ids, no network. Anything your wizard resolves once — package
versions from the registry — belongs in the answers, where it is recorded.

### Files that already exist

Each entry in `filesToWrite` can say what should happen when the app already has a file
at that path, with `whenPresent`:

| `whenPresent` | Meaning |
| --- | --- |
| *(unset)* | Your own generated file. `init` writes it; `plugin add` writes it when it is missing or identical, and stops when something else is there. `plugin remove` deletes it when it is still identical. |
| `'keep'` | A starter the app owns once written — `.env`. Written only when missing, and never removed. |
| `'replace'` | Built from the file already there, so writing it keeps what was in it. `plugin remove` can't tell your part from the rest, so it leaves the file — for a JSON file, use `jsonMerges` instead. |

### Web markup

`htmlContributions` land in `web/index.html` between `<!-- armemon:<pluginId> -->`
markers. That is how `plugin remove` takes out exactly your markup — and how it knows
the user changed it, in which case it leaves it alone.

## Where your files go

A scaffolded app has two zones: `armemon/` at the app root, which armemon owns and
re-edits, and `src/`, which belongs to the user. A plugin should write into the right
one:

| Folder | What belongs there |
| --- | --- |
| `armemon/<your-id>/` | Your config file and glue — things armemon generated and may regenerate. Build the path with `managedFile`/`managedPath`, never by hand. `appEntryContributions.providerImport.from` is resolved relative to the managed zone, so `'./<your-id>/index'` is the path to give it. |
| `src/shared/`, `src/store/slices/` | User-domain code your plugin seeds once and never reads again — the Redux plugin puts its slices in `src/store/slices/`. |
| `src/screens/<Name>Screen/` | Screens. Use `buildScreenFiles` from `@armemon-library/cli-kit` rather than composing the path yourself, so your screens match the ones `armemon create-screen` makes. |
| `src/armemon-examples/` | Demos and stock parts the user is invited to delete. Anything you put here must carry a header saying how to replace it. |

Three rules that are enforced by tests rather than review:

- **A reference to a file in another plugin's plan must not carry an extension.** The
  TypeScript-to-JavaScript conversion only rewrites names it can see in the same
  plan, so `'../../store/slices/authSlice'` is fine and
  `'…/authSlice.ts'` ships a broken path to every JavaScript app.
- **Plan paths never contain `..`.** They are app-root-relative.
- **Never spell a managed path or a cross-zone import by hand.** Import `layoutOf`,
  `managedFile`, `managedPath` and `specifierFor` from `@armemon-library/config-types`, and
  derive every path from `layoutOf(ctx)`. An app scaffolded before the managed zone
  moved to the app root still keeps it at `src/armemon/`, so a hardcoded path is
  silently wrong in one layout or the other. `specifierFor(fromFile, toFile)` computes
  the hop between zones — the distance from a screen to `armemon/` is not the same as
  the distance from a screen to `src/armemon/`, and that is exactly the kind of import
  that type-checks in the app that generated it and breaks in the next one.

## 3. The runtime (main export)

Export a `RuntimePluginObject`, or a factory returning one when the plugin needs
per-app configuration.

```tsx
import type { RuntimePluginObject } from '@armemon-library/config-types';

export function configureAnalyticsPlugin(config: Config): RuntimePluginObject {
  return {
    name: 'analytics',
    provider: ({ children }) => <AnalyticsProvider config={config}>{children}</AnalyticsProvider>,
    index: 5,                  // lower = further out in the provider chain
    loadingComponent: undefined, // shown while THIS plugin's tasks run
    tasks: [
      { name: 'analytics:init', critical: false, task: async () => sdk.init() },
    ],
  };
}
```

### Composition order

Providers nest by ascending `index`, so the smallest number is outermost. The
built-ins use: splash `-100`, essentials `0`, redux `10`, ui `20`, navigation `30`.
Pick a number that puts you where your context needs to be relative to those.

### Optional native dependencies

If a feature of your plugin is switchable and pulls in a native package, put that
import behind its **own entry point** and have the generated glue import it only
when the feature is on:

```jsonc
"exports": {
  ".":         { "require": "./dist/runtime/index.js",   "import": "./dist/runtime/index.mjs" },
  "./tracking":{ "require": "./dist/runtime/tracking.js","import": "./dist/runtime/tracking.mjs" }
}
```

This matters more than it looks. Metro resolves every import in a reachable module
at bundle time, whether or not it executes — so a conditional `require()` does not
help. If the main entry imports a package the wizard didn't install, the app fails
to bundle. `@armemon-library/redux/persist` and
`@armemon-library/essentials/netinfo` are both built this way, for exactly that
reason.

## Init tasks

Tasks run behind the splash screen, in three phases: `KIT_SETUP`, `PLUGIN_INIT`
(the default), then `USER_TASKS`. Phases are sequential barriers, so a later phase
can assume every earlier one finished.

Within a phase: `dependsOn` (by task `id`) orders tasks, `parallel` runs
dependency-independent ones together, `background` doesn't block, `critical: false`
downgrades a failure to a warning, and `timeout` is enforced whether or not your
task cooperates with `ctx.signal`. `TaskPresets` from `@armemon-library/core` covers the
common shapes.

## Testing

Test `plan()` directly — it is a pure function of answers plus context, so no
filesystem or terminal is needed:

```ts
const plan = await wizard.plan({ trackScreens: true, versions: {} }, ctx);
expect(plan.filesToWrite.find((f) => f.path.endsWith('analytics/index.ts'))).toBeDefined();
```

If your plugin has an optional native dependency, also assert that your main entry's
built output does not mention it. That is the only check that catches the bundling
failure above.
