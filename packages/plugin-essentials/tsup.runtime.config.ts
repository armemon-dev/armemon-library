// Split into two files, built SEQUENTIALLY by the package's build script.
//
// tsup runs the entries of an array config concurrently, and two concurrent DTS
// builds in one package collide: only one set of declarations survives, chosen at
// random. It shipped .d.mts without .d.ts in some packages and the reverse in
// others, which reaches a user as "Could not find a declaration file for module
// '@armemon-library/...'" in an app that type-checked fine yesterday.
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'runtime/index': 'src/runtime/index.tsx',
    // Its own entry so @react-native-community/netinfo is only reachable — and so
    // only needs installing — when the network sub-feature is on.
    'runtime/network/netInfoAdapter': 'src/runtime/network/netInfoAdapter.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  clean: false, // dist is removed by the build script — see package.json
  sourcemap: true,
  external: ['react', 'react-native', '@react-native-community/netinfo'],
  // @armemon-library/config-types is INLINED, not left external. It is one enum plus
  // type declarations, and leaving it as a runtime require created a
  // transitive-resolution problem in every consumer: a scaffolded app installs
  // this package as a file: link, so a require made from inside it resolves
  // against the link target — where its sibling workspace packages aren't
  // visible. Metro needed an extraNodeModules proxy for it, pnpm needed an
  // override, and Jest failed outright. Bundling the enum removes the require,
  // and with it all three workarounds.
  noExternal: ['@armemon-library/config-types'],
});
