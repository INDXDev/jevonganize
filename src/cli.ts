#!/usr/bin/env node
/** Entry point. Checks Node.js first, then loads the rest, so an old one gets a clear message. */
import { nodeSupported, NODE_FLOOR } from './commands/floor.ts';

if (nodeSupported(process.versions.node)) {
  const { enableCompileCache } = await import('node:module');
  const { mkdirSync } = await import('node:fs');
  const { paths } = await import('./core/paths.ts');
  // Private, as code in here runs: see docs/security.md. A failure only costs the speed-up.
  try {
    mkdirSync(paths.compileCache(), { recursive: true, mode: 0o700 });
    enableCompileCache(paths.compileCache());
  } catch {}
  const { run } = await import('./commands/index.ts');
  await run(process.argv.slice(2));
} else {
  console.error(`Jevonganize needs Node.js ${NODE_FLOOR}. This is ${process.versions.node}.`);
  process.exitCode = 2;
}
