import { build } from 'esbuild';

// Use the JS API: esbuild/bin/esbuild can be a native executable on Linux,
// so invoking that path through `node` is not portable.
await build({
  entryPoints: ['server/production_server.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  outfile: 'dist-server/server.js',
  logLevel: 'info',
});
