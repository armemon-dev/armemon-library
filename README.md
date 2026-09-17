# armemon

Interactive scaffolding CLI for React Native apps — pick your plugins, answer a few
questions, get a fully wired app with nothing left to hand-edit.

## Two ways to run it

**Without installing anything.** `npx` downloads the CLI and runs it:

```bash
npx @armemon-library/cli init react-native MyApp
```

**Installed once on your computer.** This gives you two commands, `armemon` and
`memon` — the same CLI under a long and a short name:

```bash
npm install -g @armemon-library/cli
```

```bash
armemon init react-native MyApp
```

```bash
memon init react-native MyApp
```

Every `armemon` command below also works as `memon ...`, or with
`npx @armemon-library/cli` in front when the CLI isn't installed.

Fully non-interactive, for scripts and CI:

```bash
npx @armemon-library/cli init react-native MyApp \
  --rn-version 0.76.0 --pm npm --platforms ios,android \
  --plugins redux,navigation --json
```

## Commands

| Command | What it does |
| --- | --- |
| `armemon init react-native [name]` | Scaffold a new app |
| `armemon add <platform>` | Add ios, android, web, windows or macos to an app you already have |
| `armemon plugin add <id>` | Add a plugin to an app you already have, wired in exactly as `init` would |
| `armemon plugin remove <id>` | Take a plugin out: its files, packages and wiring — never your edits |
| `armemon plugin list` | Available plugins, and which ones this app has |
| `armemon create-screen <name>` | Create a screen and register it in your navigator, param list and deep links |
| `armemon rename-screen <from> <to>` | Rename a screen everywhere it's named, `navigate()` calls included |
| `armemon remove-screen <name>` | Remove a screen and everything that registers it |
| `armemon create-slice <name>` | Create a Redux slice and register it in your store config |
| `armemon rename-slice <from> <to>` | Rename a slice: its file, binding, store entry and action prefix |
| `armemon remove-slice <name>` | Unregister a slice and delete its file |
| `armemon create-component <name>` | Create a component in a screen folder or the shared one — wires nothing |
| `armemon create-hook <name>` | Create a hook in a screen folder or the shared one — wires nothing |
| `armemon link init` | Give every screen a URL — for an app scaffolded without deep linking |
| `armemon link list\|add\|remove` | Read and edit deep links, nested under the right navigator |
| `armemon set <plugin>.<option> <value>` | Set one option in a plugin's config |
| `armemon sync` | Re-align the managed zone, and move a legacy `src/armemon/` up to `armemon/` |
| `armemon list` | The same as `armemon plugin list` |
| `armemon doctor [dir]` | Check a scaffolded app's wiring; exits non-zero on problems |

`armemon init react-native --help` lists every flag. `ARMEMON_DEBUG=1` turns the
one-line error output into a full stack trace.

**New to armemon?** Read the [user guide](docs/user-guide.md) — every command ready to
copy and paste, what each plugin does, and how to use the plugins in any React Native
app **without the CLI**.

## What you get

The React Native CLI creates the native projects; armemon does everything after
that. Depending on what you pick:

- **Config files that explain themselves.** Every option a generated file accepts is
  in that file, as a commented example with the reasoning next to it — the two slice
  authoring styles, each `persist` field, what each `textScaleMode` costs you, the
  exact bootsplash command for *your* logo and colour, the navigator options for the
  navigator you actually chose. Configuring a scaffolded app means reading and
  editing the file in front of you, not looking anything up.
- A composed `babel.config.js` — every plugin's Babel entries in one file, with
  `react-native-reanimated/plugin` last where it's needed
- `armemon/runtime.generated.ts` wiring every plugin into `@armemon-library/core`, plus
  a `runtime.config.ts` armemon never overwrites — your own init tasks, and a
  `runtimeOverrides` export that wins over anything the wizard decided

### The folder layout

```
armemon/                armemon's own files — it writes and re-edits these.
                        Commands keep it in shape; you rarely need to open it.
src/                    your workspace
├── armemon-examples/   armemon's stock parts; replace or delete them
├── screens/            your screens, one folder each
├── shared/             components, hooks and utils more than one screen uses
└── store/slices/       your Redux slices
```

The line between them is what armemon *touches again*: it regenerates
`runtime.generated`, rewires plugin glue, and edits your navigator when you add a
screen. All of that lives in `armemon/`, at the app root and outside `src/` entirely,
so the folder you work in is yours alone. Everything armemon writes once and never
re-reads — your screens, your Redux slices — lives in `src/`, and there are no
components in `armemon/` at all.

A screen is a folder, not a file, so it has somewhere to put its own parts as it
grows:

```
src/screens/OrderScreen/
├── index.tsx        the screen
├── components/      pieces only this screen renders
├── hooks/           state and data loading only this screen needs
├── utils/           pure helpers, tests beside them
└── assets/          images only this screen uses
```

Each folder ships a README saying what belongs in it, and `src/screens/ExampleScreen`
is a fully commented reference you can copy or delete. The rule they all state: a
thing moves to `src/shared/` the moment a **second** screen needs it.

### Adding, renaming and removing screens

```bash
armemon create-screen Order
armemon create-screen OrderDetails --link order/:id --params id:number
armemon create-screen Settings --navigator stack --modal --title Settings
armemon rename-screen Order Checkout
armemon remove-screen Checkout
```

`create-screen` creates the folder and registers the route everywhere it has to be:
the navigator it belongs to, that navigator's param list, and the deep-linking
config — nested under the tab or stack it lives in, so the link actually opens. It
takes `Order`, `OrderScreen` or `OrderScreen.jsx`; finds navigators in other files,
behind barrel `index.ts` files, rendered inline from another screen, or destructured
(`const { Navigator, Screen } = …`); and reads Prettier-formatted, semicolon-free and
Windows line-ending files as they are, changing only the lines it adds. Run it again
and nothing changes — run it again with `--force` and new `--params`, `--link`,
`--initial`, `--modal` or `--title`, and it updates the screen that's there.

- **Params** — `--params id:number,draft?:boolean` types the route, and a path like
  `order/:id` brings its params along. The screen is generated with typed
  `route.params`, and the deep link parses numbers and booleans back out of the URL.
- **Placement** — `--navigator` takes `stack`, `tabs`, `drawer`, a variable like
  `Tab`, or `File:Variable`. `--initial` makes it the first screen; `--modal` and
  `--title` set its options.
- **Safe** — every change is computed and parse-checked before anything is written,
  and a failed write puts every file back. A name that's already a route stops the
  command. An edit armemon can't make safely — screens inside a condition, say — is
  skipped with the exact line to add by hand.
- **Scriptable** — `--dry-run` prints the diff and writes nothing; `--json` prints
  only JSON on stdout, errors included; the exit code is 1 when an edit was skipped
  or the checks fail. It works from any folder inside the app.

`rename-screen` renames the folder, component, route, param-list entry and deep link
— the path follows the name unless you chose it yourself — plus every `navigate()`,
`screen:` param, typed-props argument, named import and doc comment that points at
it. Only real navigation counts: `tags.push('Order')` or a title that merely says
"Order" is listed, not rewritten, and so is any URL like `linkTo('/order')` still
using the old path.

`remove-screen` is `create-screen` in reverse, barrel re-exports included, and
refuses while other code still navigates to the route — listing exactly where —
unless you pass `--force`. It won't remove a route that renders a whole navigator,
or delete a folder something still imports. To move a screen to another navigator,
`remove-screen Order --keep-files`, then `create-screen Order --force --navigator Tab`.

The component is always capitalised; the deep-link path keeps the name exactly as you
typed it. `tytScreen` creates `TytScreen` at `/tyt`, `TytScreen` creates it at `/Tyt`,
and `order-history` stays `/order-history`. React Navigation matches paths
case-sensitively, so pick the casing your URLs should have. `armemon init` follows the
same rule for its starter screens.
- `App.tsx` rendering `<KitProvider>` around your navigator, themed example screen,
  or a welcome screen
- Jest setup, resolver and mocks so `npm test` passes on a fresh scaffold
- Its own check of the finished app before it says "done": every script path exists,
  every planned change landed, it type-checks, and the web target builds
- `.env` + `@env` type declarations + a `.gitignore` entry, path aliases in both
  tsconfig and Babel, and per-platform launcher scripts

Anything armemon deliberately leaves manual (native splash wiring, bundle-id
renaming, deep-link URL schemes) is printed at the end with the exact steps, because
those are the files where a bad automated patch costs you a working project.

## Platforms

`--all-accept` targets all five. Generating a target and building one are different
things — `ios/`, `android/`, `web/` and `macos/` are generated on any host, and built
on whichever machine has the toolchain:

| Target | Generated on | Built on |
| --- | --- | --- |
| `android/` | any host | any host (JDK + Android SDK) |
| `ios/` | any host | macOS + Xcode |
| `web/` | any host | any host |
| `macos/` | any host | macOS + Xcode |
| `windows/` | **Windows only** | Windows + Visual Studio |

`windows/` is the one exception, and not by armemon's choice: react-native-windows'
CLI plugin looks for `pwsh.exe` and `dotnet.exe` merely to load, so on any other OS
its `init-windows` command never registers. When that happens armemon leaves a
`windows/README.md` explaining the situation and the single command that finishes it.

### Adding a platform later

```bash
armemon add web        # or ios, android, windows, macos
```

It does the whole job: resolves the platform package release that pairs with the
React Native version your app *actually* runs (read from package.json, not the
"latest" you may have typed at init), installs it, generates the folder, adds the
launcher script, and records the platform in `armemon.config`. For `web` it also
replays your plugins' contributions, so the splash markup and its logo land in
`web/index.html` and `web/public/` exactly as they would have at init.

Two things worth knowing before you do:

- **The pairing is resolved when you run it, not when the app was created.**
  `react-native-windows` and `react-native-macos` track React Native's minor line but
  ship behind it. If no matching release exists, armemon takes the newest one that
  isn't ahead of your React Native and says so — that combination usually builds,
  with a peer warning.
- **Native modules you already installed set themselves up for the platforms that
  existed at the time.** Most handle a new one through autolinking on the next build;
  a library with manual setup steps for that platform needs them applied by hand.

### Adding and removing plugins later

```bash
armemon plugin add redux
armemon plugin remove redux
```

`plugin add` sets a plugin up in an existing app exactly as choosing it at `init` would
have. `plugin remove` takes it back out. Both work out the whole change before writing
anything and change nothing if something is in the way; `--dry-run` shows the change
first. Removal deletes only files still exactly as armemon wrote them, never while your
code still imports something it would take away, and lists everything it leaves
behind. The full rulebook: [docs/plugins.md](docs/plugins.md).

## Packages

| Package | What it is |
| --- | --- |
| [`@armemon-library/cli`](packages/cli-armemon) | The CLI — installs the `armemon` and `memon` commands |
| [`@armemon-library/core`](packages/core) | Runtime that ships inside scaffolded apps: init engine + provider chain |
| [`@armemon-library/cli-kit`](packages/cli-kit) | Node-only wizard/prompt/codegen primitives |
| [`@armemon-library/config-types`](packages/config-types) | Shared TypeScript contracts |
| [`@armemon-library/redux`](packages/plugin-redux) | Redux Toolkit, optional persistence, starter slices |
| [`@armemon-library/navigation`](packages/plugin-navigation) | React Navigation, placeholder screens or a sample auth flow |
| [`@armemon-library/essentials`](packages/plugin-essentials) | Toasts, network monitoring, loading/error overlay |
| [`@armemon-library/ui`](packages/plugin-ui) | Theme, scaling, typography, starter components |
| [`@armemon-library/splash`](packages/builtin-splash) | One splash definition, rendered natively, on web, and during startup |
| [`@armemon-library/advanced-init`](packages/builtin-advanced-init) | Env, path aliases, bundle id, lint style |

## Writing a plugin

See [docs/authoring-plugins.md](docs/authoring-plugins.md). A plugin is an ordinary
npm package with an `armemon` field in its package.json, a `./wizard` export, and a
runtime export — nothing is hardcoded in the CLI.

## Development

```bash
npm install
npm run build       # turbo, all packages
npm run typecheck
npm run lint
npm test            # regression suite, runs against built output
npm run check       # all of the above
```

Tests import each package's `dist/`, not its `src/`, so what's verified is what
ships — including the exports map, bundling and externals.

## Author

Ahmed Raza Memon
[GitHub](https://github.com/armemon-dev) ·
[LinkedIn](https://www.linkedin.com/in/linkdin-armemon)

MIT
