# @armemon-library/splash

Native splash screen setup for armemon-scaffolded apps, backed by react-native-bootsplash. Selected by default, skippable.

Native cold-start splash screen via `react-native-bootsplash`. Selected by
default, skippable, and offered only when iOS or Android is targeted.

Runs bootsplash's own asset generator after installation, against the platforms
you actually selected. The minimum splash duration you choose is passed to
`@armemon-library/core`'s runtime config, so a fast cold start doesn't flash.

Native wiring (`AppDelegate` / `MainActivity`) is left to you deliberately — it
varies enough by RN version and architecture that patching it blind risks
corrupting the project. The exact two snippets are printed when you finish.

---

Part of [armemon](https://github.com/armemon-dev/armemon-library) — interactive React Native scaffolding.
MIT © Ahmed Raza Memon
