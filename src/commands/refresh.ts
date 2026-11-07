/** `refresh`: finds files that should probably have a tag, checks them, and queues the hits. */
import { t } from './i18n/index.ts';
import type { Command } from 'commander';
import { UserError } from '../core/config.ts';
import { sanitizeLine } from '../core/sanitize.ts';
import type { RefreshCandidate, RefreshCandidates } from '../types.ts';
import { askEnvConsent } from './settings.ts';
import {
  callTool,
  command,
  costLine,
  count,
  follow,
  type JsonFlag,
  note,
  out,
  outJson,
  shown,
  withContext,
} from './shared.ts';

interface RefreshFlags extends JsonFlag {
  limit?: number;
  dryRun?: boolean;
}

function signalText({ signals }: RefreshCandidate): string {
  const parts = [
    ...signals.terms.slice(0, 3),
    ...signals.tags.slice(0, 2),
    ...(signals.similar > 0 ? [t('similar {score}', { score: signals.similar.toFixed(2) })] : []),
    ...(signals.name ? [t('name')] : []),
  ];
  return parts.map(sanitizeLine).join(' ');
}

function printCandidates(found: RefreshCandidates): void {
  out(
    t('{tag}: {tagged} files have it, {count} candidates, {checked} already checked', {
      tag: sanitizeLine(found.tag),
      tagged: count(found.tagged),
      count: count(found.candidates.length),
      checked: count(found.checked),
    }),
  );
  for (const candidate of found.candidates) {
    out(`  ${candidate.score.toFixed(2)}  ${shown(candidate.path)}  ${signalText(candidate)}`);
  }
}

async function runRefresh(tag: string, flags: RefreshFlags) {
  await withContext(flags, async (ctx) => {
    const input = { tag, ...(flags.limit !== undefined && { limit: flags.limit }) };
    const found = await callTool('refresh_candidates', input, ctx);
    if (flags.dryRun && flags.json) return outJson(found);
    if (!flags.json) printCandidates(found);
    if (found.candidates.length === 0) {
      if (!flags.json) out(t('No candidates. Nothing was sent.'));
      return undefined;
    }
    if (flags.dryRun) {
      out(costLine(found.estimate));
      return out(t('Nothing was sent.'));
    }
    note(costLine(found.estimate));
    await askEnvConsent(ctx.config.provider.name);
    const file_ids = found.candidates.map((candidate) => candidate.id);
    const final = await follow(ctx, await callTool('refresh_tag', { tag, file_ids }, ctx));
    if (final.status !== 'done') return undefined;
    if (final.total > 0 && final.failed === final.total) {
      throw new UserError(t('Every file failed. See the warnings above'));
    }
    if (!flags.json) {
      out(
        t('{count} files to review: jevonganize review --tag {tag}', {
          count: count(final.reviews ?? 0),
          tag: sanitizeLine(tag),
        }),
      );
    }
    return undefined;
  });
}

/** Adds `refresh`. */
export function addRefreshCommand(program: Command): void {
  command(program, 'refresh <tag>', t('Find files that should probably have a tag, and check them'))
    .option('--limit <n>', t('Check at most this many files (50, at most 200)'), Number)
    .option('--dry-run', t('List the candidates and the estimate, and stop'))
    .action(runRefresh);
}
