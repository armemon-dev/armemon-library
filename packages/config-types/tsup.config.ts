import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: false, // dist is removed by the build script — see package.json
  sourcemap: true,
});
