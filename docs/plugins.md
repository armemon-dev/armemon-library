# Adding and removing plugins

A plugin can be added to an app long after `armemon init`, and taken out again:

```bash
armemon plugin list              # what there is, and what this app has
armemon plugin add redux         # add one
armemon plugin remove redux      # take one out
```

Both commands work from anywhere inside the app (or pass `--dir`), and both take:

| Flag | What it does |
| --- | --- |
| `--dry-run` | Show every file that would be created, edited (as a diff) or deleted, and every package added or removed. Nothing is written. |
| `--force` | Go ahead past the things that would otherwise stop the command. Each one is left exactly as it is and listed for you. |
| `--no-verify` | Skip the checks that run afterwards. |
| `--json` | Print one JSON summary on stdout (`schemaVersion`, `ok`, and the whole change). Asks nothing. |
| `--all-accept` | Take the plugin's default answers instead of asking. |

`plugin add` also takes `--logo <path>` for the splash screen.

The rest of this page is the rulebook both commands follow. Every rule is enforced in
code and covered by tests — they are how the commands behave, not advice.

## The rules

### R1 — Everything is worked out first, and it's all or nothing

Before a single byte is written, armemon works out the entire change: every file, every
edit, every package. If any part of it can't be done safely, **nothing changes** and
armemon tells you what is in the way and what to do about it. `--dry-run` shows that
same complete change without writing it; `--json` reports it for scripts.

### R2 — Your edits are never lost

A file is replaced or deleted only when it is still exactly what armemon wrote
(formatting doesn't count — a file you ran Prettier over is still armemon's). Files
armemon shares with you — `babel.config.js`, `index.js`, `App.tsx`,
`web/vite.config.ts`, `jest.setup.js` and the rest — are edited in place through a
parser, so everything else in them stays as you wrote it.

When a file you changed is in the way — a plugin's settings file you edited, a screen
of your own where the plugin wants to write one — the command stops and changes
nothing. `--force` goes ahead **without** that file: it is never overwritten or
deleted, and it is listed at the end, along with the plugin files it still imports.

Changes made by armemon's own commands count: after `armemon set`, `create-screen` or
`create-slice` has edited a plugin's file, that file is yours. So is one written by an
earlier version of the plugin, since armemon can't tell it apart from an edit.

### R3 — Only what the plugin owns is removed

`plugin remove` deletes only the plugin's own files, in `armemon/<plugin>/` and the
ones it created under `src/`. Files at the app root are never deleted — `.prettierrc.js`,
`.env` and `.env.example` stay, and lines added to `.gitignore` stay (a `.env` should
keep being ignored). Neither are assets the plugin copied in, like a splash logo.
Everything left in place is listed.

A key a plugin merged into a file you have — the `@/*` alias in `tsconfig.json` — does
come back out, as long as it still holds the plugin's value; the rest of the file is
untouched.

### R4 — Removing never breaks the app on purpose

Removal stops while code that stays in the app still uses something that would go:

- the plugin's package (`import … from '@armemon-library/redux'`),
- a file being deleted (a screen importing `src/store/slices/authSlice`),
- a module name the plugin makes work — `import { API_URL } from '@env'`, or an
  `@/…` import through the alias `advanced-init` sets up,
- native code set up for the plugin — the launch theme `react-native-bootsplash
  generate` puts in android/ and ios/. Uninstalling its package would break the native
  build, so revert those files first (git shows which).

Each use is listed as `file:line`. Change those places first, or use `--force` to remove
the plugin anyway — then whatever is still imported stays: the package stays installed,
and a plugin file your code imports is kept, along with the files it imports in turn.

### R5 — Packages go only when nothing needs them

A package the plugin brought is uninstalled only when:

- no plugin that stays asks for it,
- no code in the app imports it (it is kept, and the importing file named), and
- no other installed package lists it as a peer dependency.

`react`, `react-native`, `@armemon-library/core` and the web and platform packages are
never removed. Adding a plugin never changes the version of a package already installed;
when the plugin was written against a different one, armemon says so.

### R6 — Same result as `init`

Adding a plugin produces the same app as choosing it at `armemon init`: the plugin's
plan is the same one init runs, applied through the same code. Removing a plugin you
just added gives you back the app you had, apart from the leftovers R3 lists. Both are
checked by tests on real apps.

A plugin whose setup depends on another's answers — the navigation plugin's sample
sign-in screens use Redux's auth slice when it exists — isn't generated again when
the other plugin comes or goes. Those files are yours by then; armemon says so.

### R7 — Can it go in at all?

Checked before anything is asked:

- the plugin exists (built in, or a plugin package the app depends on),
- it isn't already installed (`--json` reports `alreadyInstalled: true`, exit 0),
- it works on at least one platform the app targets,
- the app's React Native is new enough for it (`compatibleWith.rnMin`),
- it comes from the same place as the app's other `@armemon-library` packages — both
  from npm, at a version that matches (otherwise run `armemon upgrade` first), or both
  from the same source checkout.

### R8 — The install is part of the change

Files are written first, then packages are installed. If the install fails, or you
press Ctrl-C during it, every file is put back — `package.json` and the lockfile
included — and the command says so. Ctrl-C before anything is written changes nothing.

### R9 — What armemon can't undo, it says

Some things armemon can't take back out: a secret you put in `.env`, images a native
tool generated. A plugin lists these as its `removalNotes`, and `plugin remove` prints
them. What would break the app if left — native code that still uses the plugin — stops
the removal instead (R4).

### R10 — The app is checked afterwards

Unless `--no-verify`, the app is type-checked, the web build runs (for a web target),
and everything the plugin should have added is confirmed to be there. A failure exits
with code 1 and says how to undo the change.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Done — or nothing to do (already installed, not installed) |
| 1 | Stopped before changing anything (R1), the install failed and everything was put back (R8), or the checks found a problem (R10) |
| 130 | Cancelled |

## For plugin authors

These rules only hold if a plugin's `plan()` is **deterministic**: the same answers and
the same app must give the same plan. `plugin remove` finds out what a plugin added by
running its plan again with the answers `armemon.config` recorded. See
[authoring-plugins.md](authoring-plugins.md) for `whenPresent` and `removalNotes`.
