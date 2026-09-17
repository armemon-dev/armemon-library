// Split into two files, built SEQUENTIALLY by the package's build script.
//
// tsup runs the entries of an array config concurrently, and two concurrent DTS
// builds in one package collide: only one set of declarations survives, chosen at
// random. It shipped .d.mts without .d.ts in some packages and the reverse in
// others, which reaches a user as "Could not find a declaration file for module
// '@armemon-library/...'" in an app that type-checked fine yesterday.
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { 'wizard/index': 'src/wizard/index.ts' },
  format: ['esm'],
  dts: true,
  clean: false,
  sourcemap: true,
  platform: 'node',
});
