/** What an organize run would cost, from the index alone. */
import { setImmediate as yieldToLoop } from 'node:timers/promises';
import { answerKey, cachedAnswer } from '../ai/decide.ts';
import { estimateCost } from '../ai/pricing.ts';
import { modelTarget, type ModelTarget } from '../ai/providers.ts';
import type { Estimate, Facet } from '../types.ts';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import { toQuestions } from './facet-questions.ts';
import { appliesTo } from './facets.ts';
import { asksModel, facetsForRun } from './organize-setup.ts';
import type { OrganizeInput } from './organize.ts';

const CHARS_PER_TOKEN = 4;
/** shortcut: a flat guess per image, measure real bills if estimates drift. */
const IMAGE_TOKENS = 800;
/** Files whose cached answers are read in one query, between yields to the event loop. */
const ESTIMATE_BATCH = 256;

/** A file as the estimate sees it: its size and type, and the hash its answers are cached under. */
type EstimatedFile = { size: number; mime: string | null; state_hash: string | null };

/** Model profile name to its target. `undefined` is the default profile. */
type TargetsByProfile = Map<string | undefined, ModelTarget>;

/** What an estimate reads for each file. */
interface EstimateInputs {
  db: Db;
  config: Config;
  asked: Facet[];
  targets: TargetsByProfile;
  questionCharsByFacet: Map<string, number>;
}

/** The running totals of an estimate. Images count in tokens, text in characters. */
type EstimateTally = { cachedFiles: number; chars: number; imageTokens: number };

function isImage(mime: string | null): boolean {
  return (mime ?? '').startsWith('image/');
}

/** The characters of a file's text that would be sent: none for an image, at most the budget. */
function sentTextChars(config: Config, file: { size: number; mime: string | null }): number {
  return isImage(file.mime) ? 0 : Math.min(file.size, config.budget.text_chars);
}

function sentImageTokens(config: Config, mime: string | null): number {
  return isImage(mime) && config.send_images ? IMAGE_TOKENS : 0;
}

/** Roughly the tokens of sending one file once, with questions of this many characters. */
export function fileTokens(
  config: Config,
  file: { size: number; mime: string | null },
  questionChars: number,
): number {
  const chars = sentTextChars(config, file) + questionChars;
  return sentImageTokens(config, file.mime) + Math.ceil(chars / CHARS_PER_TOKEN);
}

/** The model of each profile a run would ask, and `undefined` for the default. */
function modelTargets(config: Config, asked: Facet[]): TargetsByProfile {
  const targets: TargetsByProfile = new Map([[undefined, modelTarget(config)]]);
  for (const { profile } of asked) {
    if (!targets.has(profile)) targets.set(profile, modelTarget(config, profile));
  }
  return targets;
}

/**
 * The facets a file would be asked, each with the key its cached answer sits under. The key is
 * null while the file has no state hash yet, since nothing can be cached for it.
 */
function wantedAnswers({ asked, targets }: EstimateInputs, file: EstimatedFile) {
  const mime = file.mime ?? 'application/octet-stream';
  const defaultTarget = targets.get(undefined)!;
  const cacheKeyOf = (facet: Facet) => {
    if (!file.state_hash) return null;
    const target = targets.get(facet.profile) ?? defaultTarget;
    return answerKey(target, facet, file.state_hash);
  };
  const applicable = asked.filter((facet) => appliesTo(facet, mime));
  return applicable.map((facet) => ({ facet, key: cacheKeyOf(facet) }));
}

/** Adds one batch of files to the totals, reading its cached answers in one query. */
function estimateBatch(inputs: EstimateInputs, files: EstimatedFile[], tally: EstimateTally): void {
  const { db, config, questionCharsByFacet } = inputs;
  const wantedByFile = files.map((file) => ({ file, wanted: wantedAnswers(inputs, file) }));
  const keys = wantedByFile.flatMap(({ wanted }) => wanted.flatMap(({ key }) => key ?? []));
  const stored = db.getAnswers(keys);
  const store = { getAnswer: (key: string) => stored.get(key) };
  for (const { file, wanted } of wantedByFile) {
    const uncached = wanted.filter(({ facet, key }) => !key || !cachedAnswer(store, key, facet));
    if (uncached.length === 0) {
      tally.cachedFiles++;
      continue;
    }
    tally.imageTokens += sentImageTokens(config, file.mime);
    tally.chars += sentTextChars(config, file);
    for (const { facet } of uncached) tally.chars += questionCharsByFacet.get(facet.id) ?? 0;
  }
}

/** What a run would cost, from the index alone. Needs no key, and sends nothing. */
export async function estimateRun(db: Db, config: Config, input: OrganizeInput): Promise<Estimate> {
  const facets = await facetsForRun(db, config, input.facets);
  const asked = facets.filter(asksModel);
  const files = db.fileStates(input.query);
  const targets = modelTargets(config, asked);
  const questionCharsByFacet = new Map(
    asked.map((facet) => [facet.id, JSON.stringify(toQuestions(facet)).length]),
  );
  const inputs = { db, config, asked, targets, questionCharsByFacet };
  const tally: EstimateTally = { cachedFiles: 0, chars: 0, imageTokens: 0 };
  for (let start = 0; start < files.length; start += ESTIMATE_BATCH) {
    estimateBatch(inputs, files.slice(start, start + ESTIMATE_BATCH), tally);
    await yieldToLoop(); // SQLite and hashing are synchronous, so nothing else ran until now
  }
  const tokens = tally.imageTokens + Math.ceil(tally.chars / CHARS_PER_TOKEN);
  const defaultTarget = targets.get(undefined)!;
  return {
    files: files.length,
    cached: tally.cachedFiles,
    facets: facets.length,
    tokens,
    // Input only: output depends on the answers, which a run has not seen yet.
    cost_usd: estimateCost({ input: tokens, output: 0 }, defaultTarget),
    provider: defaultTarget.provider,
    model: defaultTarget.modelId,
  };
}
