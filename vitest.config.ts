/**
 * FILE: vitest.config.ts
 * PATH: vitest.config.ts
 *
 * WHAT: Root Vitest configuration for the monorepo's regression suite.
 * WHY:  Tests import each package's BUILT output rather than its src, so what's
 *       verified is exactly what ships — including the exports map, the bundling,
 *       and the externals. `turbo.json` already makes `test` depend on `build`, so
 *       dist is always current.
 * HOW:  `react-native` is aliased to a Node-safe stub (see test-support/) because
 *       every runtime bundle marks it external and the real package is Flow source
 *       Node can't parse. `__DEV__` is defined because React Native injects it and
 *       several packages read it.
 *
 *       `root` is pinned to the repo root. Each package's `test` script runs
 *       `vitest run --config ../../vitest.config.ts packages/<name>/test` from its own
 *       folder, and Vitest resolves `include` against its root, which defaults to the
 *       working directory — so from a package folder the glob matched nothing, and
 *       with `passWithNoTests` on, `npm test` and CI passed without running a test.
 *       Finding no tests is now a failure, so that can't happen quietly again.
 *
 *       Suites read the built output of packages their own package doesn't depend on
 *       (cli-kit's bundle-graph checks read every plugin's dist), so turbo.json makes
 *       every `test` wait for `@armemon-library/cli#build` — the CLI depends on every
 *       package, so that is "everything is built". Without it a plugin's build, which
 *       deletes dist first, raced another package's tests.
 */
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  root: __dirname,
  resolve: {
    alias: [
      {
        find: /^react-native$/,
        replacement: path.resolve(__dirname, 'test-support/react-native-stub.ts'),
      },
    ],
  },
  define: {
    __DEV__: 'true',
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: false,
    // These import real built bundles and run prettier over generated output; the
    // 5s default trips on a cold first import rather than on anything being wrong.
    testTimeout: 30000,
  },
});
