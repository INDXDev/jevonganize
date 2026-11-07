import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    cli: 'src/cli.ts',
    'server/start': 'src/server/start.ts',
    'extract/worker': 'src/extract/worker.ts',
    'core/tag-worker': 'src/core/tag-worker.ts',
    'desktop/main': 'src/desktop/main.ts',
  },
  format: 'esm',
  platform: 'node',
  // Empties dist, so hashed chunks do not pile up. `vite build` runs after this and writes dist/web.
  // A negated pattern to keep dist/web deleted it anyway on Windows.
  clean: true,
  // Everything in `dependencies` stays external, including the native sharp, @napi-rs/canvas and
  // koffi. Electron is a devDependency, which would otherwise be bundled.
  deps: { neverBundle: ['electron'] },
});
