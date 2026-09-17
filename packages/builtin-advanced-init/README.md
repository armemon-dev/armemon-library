# @armemon-library/advanced-init

Advanced setup for armemon-scaffolded apps — env strategy, path aliases, bundle id confirmation, lint style. Selected by default, skippable.

Environment variables, absolute imports, bundle identifier, and lint style.
Selected by default, skippable.

- `.env` + `.env.example` + `@env` type declarations, with `.env` added to
  `.gitignore`
- `@/*` → `./src/*` in both `tsconfig.json` and Babel, so aliases work at
  runtime and not just in the editor
- Bundle id read from the generated native projects, not guessed
- Optional stricter Prettier config

---

Part of [armemon](https://github.com/armemon-dev/armemon-library) — interactive React Native scaffolding.
MIT © Ahmed Raza Memon
