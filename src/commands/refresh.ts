/** `refresh`: finds files that should probably have a tag, checks them, and queues the hits. */
import { t } from './i18n/index.ts';
import type { Command } from 'commander';
import { sanitizeLine } from '../core/sanitize.ts';
import type { Context } from '../core/tools.ts';
import type { Job, RefreshCandidate, RefreshCandidates } from '../types.ts';
import { askEnvConsent } from './prompts.ts';
import {
  callTool,
  command,
  costLine,
  count,
  failIfEveryFileFailed,
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

/** Why a file is a candidate: its strongest terms and tags, and the other signals that fired. */
function signalText({ signals }: RefreshCandidate): string {
  const parts = [...signals.terms.slice(0, 3), ...signals.tags.slice(0, 2)];
  if (signals.similar > 0) parts.push(t('similar {score}', { score: signals.similar.toFixed(2) }));
  if (signals.name) parts.push(t('name'));
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

/** Sends the candidates to the model, which queues the ones that fit as review items. */
async function checkCandidates(tag: string, found: RefreshCandidates, ctx: Context): Promise<Job> {
  note(costLine(found.estimate));
  await askEnvConsent(ctx.config.provider.name);
  const file_ids = found.candidates.map((candidate) => candidate.id);
  return follow(ctx, await callTool('refresh_tag', { tag, file_ids }, ctx));
}

async function runRefresh(tag: string, flags: RefreshFlags): Promise<void> {
  await withContext(flags, async (ctx) => {
    const input = { tag, ...(flags.limit !== undefined && { limit: flags.limit }) };
    const found = await callTool('refresh_candidates', input, ctx);
    if (flags.dryRun && flags.json) return outJson(found);
    if (!flags.json) printCandidates(found);
    if (found.candidates.length === 0) {
      return flags.json ? undefined : out(t('No candidates. Nothing was sent.'));
    }
    if (flags.dryRun) {
      out(costLine(found.estimate));
      return out(t('Nothing was sent.'));
    }
    const final = await checkCandidates(tag, found, ctx);
    if (final.status !== 'done') return undefined;
    failIfEveryFileFailed(final);
    if (flags.json) return undefined;
    const queued = { count: count(final.reviews ?? 0), tag: sanitizeLine(tag) };
    return out(t('{count} files to review: jevonganize review --tag {tag}', queued));
  });
}

/** Adds `refresh`. */
export function addRefreshCommand(program: Command): void {
  command(program, 'refresh <tag>', t('Find files that should probably have a tag, and check them'))
    .option('--limit <n>', t('Check at most this many files (50, at most 200)'), Number)
    .option('--dry-run', t('List the candidates and the estimate, and stop'))
    .action(runRefresh);
}
