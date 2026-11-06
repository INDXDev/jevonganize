/** What an organize run would cost, from the index alone. */
import { setImmediate as yieldToLoop } from 'node:timers/promises';
import { answerKey, cachedAnswer } from '../ai/decide.ts';
import { estimateCost } from '../ai/pricing.ts';
import { modelTarget, type ModelTarget } from '../ai/providers.ts';
import type { Estimate, Facet } from '../types.ts';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import { appliesTo, toQuestions } from './facets.ts';
import { asksModel, facetsForRun, type OrganizeInput } from './organize.ts';

const CHARS_PER_TOKEN = 4;
/** shortcut: a flat guess per image, measure real bills if estimates drift. */
const IMAGE_TOKENS = 800;
const ESTIMATE_BATCH = 256;

/** The model of each profile a run would ask, and `undefined` for the default. */
function modelTargets(config: Config, asked: Facet[]) {
  const targets = new Map<string | undefined, ModelTarget>([[undefined, modelTarget(config)]]);
  for (const { profile } of asked) {
    if (!targets.has(profile)) targets.set(profile, modelTarget(config, profile));
  }
  return targets;
}

/** What an estimate reads for each file. */
interface EstimateInputs {
  db: Db;
  config: Config;
  asked: Facet[];
  targets: ReturnType<typeof modelTargets>;
  questionChars: Map<string, number>;
}

/** The running totals of an estimate. */
type EstimateTally = { cached: number; chars: number; tokens: number };

/** The answers a file needs, each with the cache key to find it under, if it has one. */
function wantedAnswers(
  { asked, targets }: EstimateInputs,
  file: { size: number; mime: string | null; state_hash: string | null },
) {
  const mime = file.mime ?? 'application/octet-stream';
  const { state_hash } = file;
  const keyOf = (facet: Facet) => {
    const target = targets.get(facet.profile) ?? targets.get(undefined)!;
    return state_hash ? answerKey(target, facet, state_hash) : null;
  };
  const applicable = asked.filter((facet) => appliesTo(facet, mime));
  const wanted = applicable.map((facet) => ({ facet, key: keyOf(facet) }));
  return { size: file.size, mime, wanted };
}

/** Adds one batch of files to the totals, reading its cached answers in one query. */
function estimateBatch(
  inputs: EstimateInputs,
  files: Parameters<typeof wantedAnswers>[1][],
  tally: EstimateTally,
): void {
  const { db, config, questionChars } = inputs;
  const batch = files.map((file) => wantedAnswers(inputs, file));
  const stored = db.getAnswers(batch.flatMap(({ wanted }) => wanted.flatMap((w) => w.key ?? [])));
  const store = { getAnswer: (key: string) => stored.get(key) };
  for (const { size, mime, wanted } of batch) {
    const missing = wanted.filter(
      ({ facet, key }) => key === null || !cachedAnswer(store, key, facet),
    );
    if (missing.length === 0) {
      tally.cached++;
      continue;
    }
    if (mime.startsWith('image/')) tally.tokens += config.send_images ? IMAGE_TOKENS : 0;
    else tally.chars += Math.min(size, config.budget.text_chars);
    for (const { facet } of missing) tally.chars += questionChars.get(facet.id) ?? 0;
  }
}

/** What a run would cost, from the index alone. Needs no key, and sends nothing. */
export async function estimateRun(db: Db, config: Config, input: OrganizeInput): Promise<Estimate> {
  const facets = await facetsForRun(db, config, input.facets);
  const asked = facets.filter(asksModel);
  const files = db.fileStates(input.query);
  const targets = modelTargets(config, asked);
  const questionChars = new Map(
    asked.map((facet) => [facet.id, JSON.stringify(toQuestions(facet)).length]),
  );
  const inputs = { db, config, asked, targets, questionChars };
  const tally = { cached: 0, chars: 0, tokens: 0 };
  for (let start = 0; start < files.length; start += ESTIMATE_BATCH) {
    estimateBatch(inputs, files.slice(start, start + ESTIMATE_BATCH), tally);
    await yieldToLoop(); // SQLite and hashing are synchronous, so nothing else ran until now
  }
  const tokens = tally.tokens + Math.ceil(tally.chars / CHARS_PER_TOKEN);
  const target = targets.get(undefined)!;
  return {
    files: files.length,
    cached: tally.cached,
    facets: facets.length,
    tokens,
    cost_usd: estimateCost(tokens, target),
    provider: target.provider,
    model: target.modelId,
  };
}
