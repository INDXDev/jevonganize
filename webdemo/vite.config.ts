/** The web demo: the real UI on the mock's fictional files, read-only, as a static site. */
import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vite';
import app from '../vite.config.ts';

export default mergeConfig(
  app,
  defineConfig({
    root: fileURLToPath(new URL('../src/web', import.meta.url)),
    define: {
      'import.meta.env.VITE_MOCK': JSON.stringify('1'),
      'import.meta.env.VITE_DEMO': JSON.stringify('1'),
    },
    build: { outDir: fileURLToPath(new URL('dist', import.meta.url)) },
  }),
);
