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
  // `vite build` runs first, and its output is dist/web. Hashed chunks would otherwise pile up.
  clean: ['dist/**', '!dist/web/**'],
  // Everything in `dependencies` stays external, including the native sharp, @napi-rs/canvas and
  // koffi. Electron is a devDependency, which would otherwise be bundled.
  deps: { neverBundle: ['electron'] },
});
