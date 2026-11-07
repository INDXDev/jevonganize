/** Puts questions about one file to a model, with the only `experimental_decide` call. */
import type { TokenUsage } from './pricing.ts';
import { experimental_decide, Experimental_DecisionRefusalError } from 'ai';
import type { RawAnswers } from '../core/facet-answers.ts';
import type { Question } from '../core/facet-questions.ts';
import type { FileState } from '../types.ts';
import { newMarker, stateParts } from './file-state.ts';
import { type ResolvedModel, translateError } from './providers.ts';

/** Retries the SDK makes on a transient failure, before the request counts as failed. */
const MAX_RETRIES = 3;

/** Questions by id, as `experimental_decide` takes them. */
type Questions = Record<string, Question>;
/** Hears what one billed call cost. */
type OnTokens = (tokens: TokenUsage) => void;

/**
 * The same model, with each raw call reporting what it cost. The meter sits on the model, under the
 * SDK, because a refusal is billed too and the error the SDK throws for it carries no usage.
 */
function withTokenMeter(model: ResolvedModel['model'], onTokens: OnTokens) {
  const meteredDoDecide: typeof model.doDecide = async (options) => {
    const result = await model.doDecide(options);
    const { usage } = result;
    onTokens({ input: usage?.inputTokens ?? 0, output: usage?.outputTokens ?? 0 });
    return result;
  };
  // Every other property is the model's own, so the SDK sees the model it was given.
  return new Proxy(model, {
    get: (target, key) => (key === 'doDecide' ? meteredDoDecide : Reflect.get(target, key)),
  });
}

/** The questions whose ids are not in `ids`. */
const withoutIds = (questions: Questions, ids: string[]) =>
  Object.fromEntries(Object.entries(questions).filter(([id]) => !ids.includes(id)));

/** What one request ends with: answers to every question, or a refusal naming some of them. */
type Outcome = { answers: RawAnswers } | { refusal: Experimental_DecisionRefusalError };

/** One request. A refusal comes back as a value, and any other failure as a translated error. */
async function requestDecision(
  state: FileState,
  questions: Questions,
  model: ResolvedModel['model'],
  provider: ResolvedModel['provider'],
): Promise<Outcome> {
  try {
    const { answers } = await experimental_decide({
      model,
      state: stateParts(state, newMarker()),
      questions,
      maxRetries: MAX_RETRIES,
    });
    return { answers };
  } catch (error) {
    if (Experimental_DecisionRefusalError.isInstance(error)) return { refusal: error };
    throw translateError(error, provider);
  }
}

/** Asks until everything is answered or refused. A refusal costs only its own questions. */
async function askChunk(
  state: FileState,
  questions: Questions,
  resolved: ResolvedModel,
  onTokens: OnTokens,
): Promise<RawAnswers> {
  const refusals: RawAnswers = {};
  const model = withTokenMeter(resolved.model, onTokens);
  let remaining = questions;
  while (Object.keys(remaining).length > 0) {
    const outcome = await requestDecision(state, remaining, model, resolved.provider);
    if ('answers' in outcome) return { ...refusals, ...outcome.answers };
    remaining = recordRefusal(outcome.refusal, remaining, refusals);
  }
  return refusals;
}

/**
 * Notes each question a refusal names as refused, and returns the questions left to ask. A refusal
 * that names none of them is thrown, as asking again would loop for ever.
 */
function recordRefusal(
  refusal: Experimental_DecisionRefusalError,
  asked: Questions,
  refusals: RawAnswers,
): Questions {
  const unrefused = withoutIds(asked, refusal.questionIds);
  const namesNoneAsked = Object.keys(unrefused).length === Object.keys(asked).length;
  if (namesNoneAsked) throw refusal;
  for (const id of refusal.questionIds) refusals[id] = { type: 'refusal' };
  return unrefused;
}

/** Who hears of a request's progress as it happens. */
interface AskListeners {
  onChunk?: (answers: RawAnswers) => void;
  onTokens?: OnTokens;
}

/**
 * Asks questions about a fitted state, in chunks a request allows. Each chunk bills the state, and
 * `onChunk` and `onTokens` hear at once, so a later failure cannot lose what was paid for.
 */
export async function askQuestions(
  state: FileState,
  questions: Questions,
  resolved: ResolvedModel,
  { onChunk, onTokens }: AskListeners = {},
): Promise<{ answers: RawAnswers; tokens: TokenUsage }> {
  const result = { answers: {} as RawAnswers, tokens: { input: 0, output: 0 } };
  const recordTokens = (tokens: TokenUsage) => {
    result.tokens.input += tokens.input;
    result.tokens.output += tokens.output;
    onTokens?.(tokens);
  };
  for (const chunk of chunksOf(questions, resolved.caps.maxQuestions)) {
    Object.assign(result.answers, await askChunk(state, chunk, resolved, recordTokens));
    onChunk?.(result.answers);
  }
  return result;
}

/** Splits questions into groups of at most `size`, in their original order. */
function chunksOf(questions: Questions, size: number): Questions[] {
  const entries = Object.entries(questions);
  const chunkSize = Math.min(size, entries.length);
  const chunks: Questions[] = [];
  for (let start = 0; start < entries.length; start += chunkSize)
    chunks.push(Object.fromEntries(entries.slice(start, start + chunkSize)));
  return chunks;
}
