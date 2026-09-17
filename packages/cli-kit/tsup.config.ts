import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: false, // dist is removed by the build script — see package.json
  sourcemap: true,
  platform: 'node',
  // Explicitly external. tsup externalises `dependencies` by default, but these two
  // are large CommonJS packages and inlining either produces a broken ESM bundle:
  // TypeScript's own loader does a dynamic require('fs'), which throws
  // "Dynamic require of \"fs\" is not supported" the moment the bundle is imported.
  // Naming them here means a stray devDependency listing can't silently re-inline
  // 200k lines of compiler.
  external: ['typescript', 'prettier'],
});
