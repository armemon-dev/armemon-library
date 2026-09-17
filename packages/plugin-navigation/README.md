# @armemon-library/navigation

React Navigation plugin for armemon — stack/tabs/drawer setup with placeholder screens.

React Navigation for armemon apps: stack, bottom tabs, drawer, or tabs nested
in a stack, with placeholder screens or a working Splash → Login/Register →
Home sample flow.

Choosing Drawer wires `react-native-gesture-handler`'s entry import and
`react-native-reanimated`'s Babel plugin automatically. When the Redux plugin is
also selected with its `auth` slice, the sample screens dispatch to it — and
honour whatever you named the token field.

---

Part of [armemon](https://github.com/armemon-dev/armemon-library) — interactive React Native scaffolding.
MIT © Ahmed Raza Memon
