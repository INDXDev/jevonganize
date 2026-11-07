/** Answers one file's facets from the cache, or else by asking the model once for all of them. */
import type { TokenUsage } from './pricing.ts';
import { fromAnswers, type RawAnswers, validAnswer } from '../core/facet-answers.ts';
import { facetHash, type Question, toQuestions } from '../core/facet-questions.ts';
import type { Answer, Facet, FileState } from '../types.ts';
import { fitState, fittedHash, sha256 } from './file-state.ts';
import type { ModelTarget, ResolvedModel } from './providers.ts';
import { askQuestions } from './questions.ts';

/** The part of the database `decide` needs. */
export interface AnswerStore {
  getAnswer(key: string): Answer[] | undefined;
  putAnswer(key: string, facet: string, body: Answer[]): void;
}

/** Hashes what this model would be sent, before any marker is added. */
export function stateHash(state: FileState, target: Pick<ModelTarget, 'caps'>): string {
  return fittedHash(fitState(state, target.caps).state);
}

/** The cache key of one facet's answer: everything that can change it. */
export function answerKey(target: ModelTarget, facet: Facet, state_hash: string): string {
  const { provider, modelId, endpoint } = target;
  return sha256(
    JSON.stringify([provider, modelId, endpoint ?? null, facetHash(facet), state_hash]),
  );
}

/** A cached answer picks a tag, so it is checked on read. Anything off is a miss. */
export function cachedAnswer(
  store: Pick<AnswerStore, 'getAnswer'>,
  key: string,
  facet: Facet,
): Answer[] | undefined {
  const rows = store.getAnswer(key);
  const isValid = rows?.length && rows.every((row) => validAnswer(facet, row));
  return isValid ? rows : undefined;
}

/**
 * Requests under way, by answer key. A second file with the same content waits on the first
 * file's request instead of paying for its own.
 */
const inFlight = new Map<string, Promise<Answer[]>>();

/** A facet that puts questions to the model, and the cache key of its answer. */
interface AskingFacet {
  facet: Facet;
  questions: Record<string, Question>;
  key: string;
}

/** The facets that put at least one question to the model, each with its answer's cache key. */
function askingFacets(facets: Facet[], model: ResolvedModel, state_hash: string): AskingFacet[] {
  return facets.flatMap((facet) => {
    const questions = toQuestions(facet);
    if (Object.keys(questions).length === 0) return [];
    return [{ facet, questions, key: answerKey(model, facet, state_hash) }];
  });
}

/** Answers that cost nothing: cached rows, or another file's request for the same key. */
type CostlessAnswer = Answer[] | Promise<Answer[]>;

/** Splits facets into those with a costless answer, and those that need a request of their own. */
function splitByCost(facetsAsking: AskingFacet[], store: AnswerStore) {
  const costless: CostlessAnswer[] = [];
  const toAsk: AskingFacet[] = [];
  for (const asking of facetsAsking) {
    const costlessAnswer =
      cachedAnswer(store, asking.key, asking.facet) ?? inFlight.get(asking.key);
    if (costlessAnswer) costless.push(costlessAnswer);
    else toAsk.push(asking);
  }
  return { costless, toAsk };
}

/** Saves each facet's rows once, as soon as all of its questions have an answer. */
function createAnswerSaver(toAsk: AskingFacet[], model: ResolvedModel, store: AnswerStore) {
  const savedRows = new Map<string, Answer[]>();
  // Without native probabilities, a confidence is the model's own estimate.
  const estimated = !model.caps.native;
  const save = ({ facet, key }: AskingFacet, answers: RawAnswers) => {
    const rows = fromAnswers(facet, answers).map((row) => ({ ...row, estimated }));
    store.putAnswer(key, facet.id, rows);
    savedRows.set(key, rows);
    return rows;
  };
  /** The facet's rows, saved from `answers` unless they already were. */
  const saveOnce = (asking: AskingFacet, answers: RawAnswers) =>
    savedRows.get(asking.key) ?? save(asking, answers);
  /** Saves every facet whose questions `answers` now all cover, as a stream delivers them. */
  const saveCompleted = (answers: RawAnswers) => {
    for (const asking of toAsk) {
      const isComplete = Object.keys(asking.questions).every((id) => id in answers);
      if (isComplete) saveOnce(asking, answers);
    }
  };
  return { saveCompleted, saveOnce };
}

/** Lets identical files wait on `running` until it settles. */
function shareInFlight(key: string, running: Promise<Answer[]>): Promise<Answer[]> {
  const forget = () => inFlight.delete(key);
  inFlight.set(key, running);
  void running.then(forget, forget);
  return running;
}

/** The model and the store a request reports to. */
interface RequestTarget {
  model: ResolvedModel;
  store: AnswerStore;
  onTokens?: (tokens: TokenUsage) => void;
}

/**
 * Puts every facet's questions in one request, and gives each facet a promise of its own rows that
 * identical files can share. Synchronous, so `inFlight` is filled before any await.
 */
function requestAnswers(state: FileState, toAsk: AskingFacet[], target: RequestTarget) {
  const { model, store, onTokens } = target;
  const { saveCompleted, saveOnce } = createAnswerSaver(toAsk, model, store);
  const questions: Record<string, Question> = Object.assign(
    {},
    ...toAsk.map((asking) => asking.questions),
  );
  const request = askQuestions(state, questions, model, { onChunk: saveCompleted, onTokens });
  const rowsPerFacet = toAsk.map((asking) => {
    const rows = request.then(({ answers }) => saveOnce(asking, answers));
    return shareInFlight(asking.key, rows);
  });
  return { request, rowsPerFacet };
}

/** What `requestAnswers` would return when every facet was answered for free. */
const NOTHING_TO_ASK = {
  request: Promise.resolve({ tokens: { input: 0, output: 0 } }),
  rowsPerFacet: [],
};

/** What `decide` found for one file. */
interface Decision {
  answers: Answer[];
  tokens: TokenUsage;
  cached: number;
  warnings: string[];
  state_hash: string;
}

/**
 * Returns raw answers for every facet that asks a question. All of a file's unanswered facets go
 * in one request, except where `maxQuestions` splits it. `cached` counts facets that cost nothing.
 *
 * A rejected key throws a `UserError`, which stops the job. Anything else fails this file only.
 * `onTokens` hears of each billed call, including those of a file that then fails.
 */
export async function decide(
  file: { state: FileState; onTokens?: (tokens: TokenUsage) => void },
  facets: Facet[],
  model: ResolvedModel,
  store: AnswerStore,
): Promise<Decision> {
  const { state, warnings } = fitState(file.state, model.caps);
  const state_hash = fittedHash(state);
  // No await until `inFlight` is filled, so two identical files cannot both miss.
  const { costless, toAsk } = splitByCost(askingFacets(facets, model, state_hash), store);
  const requestTarget = { model, store, onTokens: file.onTokens };
  const { request, rowsPerFacet } =
    toAsk.length > 0 ? requestAnswers(state, toAsk, requestTarget) : NOTHING_TO_ASK;
  const answers = (await Promise.all([...costless, ...rowsPerFacet])).flat();
  const { tokens } = await request;
  return { answers, tokens, cached: costless.length, warnings, state_hash };
}
