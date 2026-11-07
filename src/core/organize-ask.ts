/**
 * The model calls of an organize run for one file: each profile's decision model, then the `[ner]`
 * model for proper names. Each call goes into the run's tally at once, and into a queued `usage` row.
 */
import { answerKey, decide, stateHash } from '../ai/decide.ts';
import type { ResolvedModel } from '../ai/providers.ts';
import { extractNames } from '../ai/proper-names.ts';
import type { Answer, Facet, FileState } from '../types.ts';
import { errorMessage, UserError } from './config.ts';
import { holdsNames, refusedSuggestions } from './names.ts';
import { addUsage, type FileRef, queueUsage, type Session } from './organize-session.ts';
import { facetsAskedOf } from './organize-setup.ts';
import { callMeter } from './usage.ts';

/** What the models said about a file, and the `state_hash` its result records. */
export interface ModelAnswers {
  answers: Answer[];
  warnings: string[];
  state_hash: string;
}

/**
 * Asks one model about a file's facets, under the shared limit. Its calls become one `usage` row,
 * queued even when the file then fails, as they were paid for.
 */
async function askOneModel(
  session: Session,
  state: FileState,
  asked: Facet[],
  model: ResolvedModel,
) {
  const meter = callMeter(session.tally, model);
  const ask = () => decide({ state, onTokens: meter.onTokens }, asked, model, session.db);
  try {
    const decision = await session.modelLimit(ask);
    return { ...decision, billed: meter.calls > 0 };
  } finally {
    if (meter.calls > 0) queueUsage(session, 'organize', model, meter.tokens);
  }
}

/** One model's answers about a file, and whether any of them was paid for. */
type ModelDecision = Awaited<ReturnType<typeof askOneModel>>;

/** The links from a file to the cached answers one model gave for these facets. */
const answerLinks = (id: number, model: ResolvedModel, asked: Facet[], stateHashSeen: string) =>
  asked.map((facet) => ({ id, facet: facet.id, key: answerKey(model, facet, stateHashSeen) }));

/** A file that got answers and paid for none was served from the cache, for the hit rate. */
function countCacheHit(session: Session, decisions: ModelDecision[]): void {
  const paid = decisions.some((decision) => decision.billed);
  const answeredFree = decisions.some((decision) => decision.cached > 0);
  if (!paid && answeredFree) session.tally.cached++;
}

/** Asks each profile's model about its facets, and links the answers. */
export async function askModels(
  session: Session,
  fileId: number,
  state: FileState,
  facets: Facet[],
): Promise<ModelAnswers> {
  const decisions: ModelDecision[] = [];
  let hashTargetStateHash: string | undefined;
  for (const [profile, model] of session.models) {
    const asked = facetsAskedOf(facets, profile);
    if (asked.length === 0) continue;
    const decision = await askOneModel(session, state, asked, model);
    decisions.push(decision);
    session.pending.links.push(...answerLinks(fileId, model, asked, decision.state_hash));
    if (model === session.hashTarget) hashTargetStateHash = decision.state_hash;
  }
  countCacheHit(session, decisions);
  // The hash the target model saw when it was asked, or the same hash computed here.
  const state_hash = hashTargetStateHash ?? stateHash(state, session.hashTarget);
  return {
    answers: decisions.flatMap((decision) => decision.answers),
    warnings: decisions.flatMap((decision) => decision.warnings),
    state_hash,
  };
}

/** The proper names in a file the gate passed. A failure here costs the names, not the file's tags. */
export async function readProperNames(
  session: Session,
  row: FileRef,
  state: FileState,
  answers: Answer[],
) {
  const { db, ner, modelLimit, tally } = session;
  if (!ner || !holdsNames(answers)) return [];
  const knownTags = [...(db.fileRow(row.id)?.tags ?? []), ...refusedSuggestions(db, row.id)];
  try {
    const { tags, tokens } = await modelLimit(() => extractNames(state, ner, knownTags));
    addUsage(tally, tokens, ner);
    queueUsage(session, 'names', ner, tokens);
    return tags;
  } catch (error) {
    if (error instanceof UserError) throw error;
    tally.warnings.push(`${row.path}: ${errorMessage(error)}`);
    return [];
  }
}
