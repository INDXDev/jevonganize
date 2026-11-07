/** `scan [path]`: updates the index. Free and local: nothing is sent anywhere. */
import { t } from './i18n/index.ts';
import { indexedPath } from '../core/config.ts';
import type { Context } from '../core/tools.ts';
import type { Job } from '../types.ts';
import { callTool, count, follow, type JsonFlag, out, shown, withContext } from './shared.ts';

type ScanResult = NonNullable<Job['scan']>;

async function addLibraryUnlessKnown(root: string, ctx: Context): Promise<void> {
  const libraries = await callTool('list_libraries', {}, ctx);
  const isKnown = libraries.some((library) => library.path === root);
  if (!isKnown) await callTool('add_library', { path: root }, ctx);
}

function printScanSummary(root: string | undefined, scan: ScanResult): void {
  const { files, added, changed, restores, skipped } = scan;
  const parts = [
    t('{count} files', { count: count(files) }),
    t('{count} new', { count: count(added) }),
    t('{count} changed', { count: count(changed) }),
  ];
  if (restores > 0) parts.push(t('{count} restore items', { count: count(restores) }));
  const scope = root === undefined ? t('all libraries') : shown(root);
  out(t('Scanned {root}: {summary}.', { root: scope, summary: parts.join(', ') }));
  if (skipped > 0) out(t('Skipped {count} by exclusion rules.', { count: count(skipped) }));
}

/** Adds the path as a library if it is new, then scans it, or every library with no path. */
export async function runScan(path: string | undefined, flags: JsonFlag): Promise<void> {
  await withContext(flags, async (ctx) => {
    const root = path === undefined ? undefined : indexedPath(path);
    if (root !== undefined) await addLibraryUnlessKnown(root, ctx);
    const final = await follow(ctx, await callTool('scan', { path: root }, ctx));
    if (flags.json || !final.scan) return;
    printScanSummary(root, final.scan);
  });
}
