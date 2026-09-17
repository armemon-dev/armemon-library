# @armemon-library/cli-kit

Node-only wizard, prompt, and shell-out primitives shared by the armemon CLI and every plugin's wizard.

Node-only primitives shared by the armemon CLI and every plugin wizard: prompt
wrappers with `--all-accept` and TTY handling, plugin discovery, dependency
version resolution, filesystem patchers, and runtime codegen.

Not a runtime dependency of scaffolded apps — it never reaches an app bundle.

Prompt wrappers refuse to run without a TTY, with a message pointing at
`--all-accept`, rather than failing inside `@clack/core`.

---

Part of [armemon](https://github.com/armemon-dev/armemon-library) — interactive React Native scaffolding.
MIT © Ahmed Raza Memon
