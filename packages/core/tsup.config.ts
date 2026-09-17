import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  // Both formats: Metro (native) resolves via "require", Vite's Web build (Rollup)
  // requires an "import" condition to exist at all or fails resolution outright
  // (confirmed live: `vite build` threw "No known conditions for '.'" against a
  // require-only exports map).
  format: ['cjs', 'esm'],
  dts: true,
  clean: false, // dist is removed by the build script — see package.json
  sourcemap: true,
  external: ['react', 'react-native'],
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
