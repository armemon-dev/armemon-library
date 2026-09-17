import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'bin/armemon': 'bin/armemon.ts',
  },
  format: ['esm'],
  // Declarations for the library entry only: the bin is an executable, and a
  // dist/bin/armemon.d.ts describes nothing anyone can import.
  dts: { entry: { index: 'src/index.ts' } },
  clean: false, // dist is removed by the build script — see package.json
  sourcemap: true,
  platform: 'node',
});
