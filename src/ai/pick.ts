/** Picks the catalog topics that fit a folder, out of every topic in the catalog. */
import pLimit from 'p-limit';
import type { FileState } from '../types.ts';
import { askQuestions } from './decide.ts';
import type { ResolvedModel } from './providers.ts';

/** Options per choice question, since `other` makes the 255 providers allow. */
const GROUP_SIZE = 254;
/** Keeps a request near 20k tokens, inside Jev's 32k even though Jev sets no question limit. */
const GROUPS_PER_REQUEST = 8;
/** A question costs about 155 tokens before its text, so only a shortlist gets one of its own. */
const SHORTLIST = 1000;
const BOOLEANS_PER_REQUEST = 400;
/** Below this the model is saying no, so a short list beats a padded one. */
const FLOOR = 0.5;

const LISTING = 'The file names listed below come from one folder.';
const SWEEP_QUESTION = `${LISTING} Which one of these subjects best describes specific content found in some of those files? Choose other if none is specific to them.`;
const NONE = 'None of these is specific to the files.';
const confirmQuestion = (label: string) =>
  `${LISTING} Would "${label}" be a useful tag for some of them? Answer no if it only describes files or text in general, or would fit almost any folder.`;

/** One topic the model thinks fits, with how sure it is. */
export interface RankedTopic {
  value: string;
  probability: number;
}

type Ask = (questions: Parameters<typeof askQuestions>[1]) => ReturnType<typeof askQuestions>;

const inPieces = <T>(items: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );

/** Every label competes in a choice question. Each option's probability ranks it in the shortlist. */
async function sweep(labels: string[], perRequest: number, ask: Ask) {
  const requests = inPieces(inPieces(labels, GROUP_SIZE), perRequest);
  const scored = await Promise.all(
    requests.map(async (groups) => {
      const entries = groups.map((group, index) => {
        const options = group.map((label, option) => [`c${option}`, label]);
        const criteria = { ...Object.fromEntries(options), other: NONE };
        return [`g${index}`, { type: 'choice' as const, instructions: SWEEP_QUESTION, criteria }];
      });
      const { answers, tokens } = await ask(Object.fromEntries(entries));
      const topics = groups.flatMap((group, index) => {
        const answer = answers[`g${index}`];
        if (answer?.type !== 'choice') return [];
        const odds = answer.probabilities ?? { [answer.choice]: 1 };
        return group.map((value, option) => ({
          value,
          probability: odds[`c${option}`] ?? 0,
        }));
      });
      return { topics, tokens };
    }),
  );
  const ranked = scored.flatMap((result) => result.topics);
  const shortlist = ranked
    .filter((topic) => topic.probability > 0)
    .toSorted((a, b) => b.probability - a.probability)
    .slice(0, SHORTLIST)
    .map((topic) => topic.value);
  return { shortlist, tokens: scored.reduce((total, result) => total + result.tokens, 0) };
}

/** Judges each shortlisted label alone, which also removes the ones that only won a weak group. */
async function confirm(labels: string[], perRequest: number, ask: Ask) {
  const confirmed = await Promise.all(
    inPieces(labels, perRequest).map(async (piece) => {
      const entries = piece.map((label, index) => [
        `t${index}`,
        { type: 'boolean' as const, instructions: confirmQuestion(label) },
      ]);
      const { answers, tokens } = await ask(Object.fromEntries(entries));
      const topics = piece.flatMap((value, index) => {
        const answer = answers[`t${index}`];
        return answer?.type === 'boolean' ? [{ value, probability: answer.probability }] : [];
      });
      return { topics, tokens };
    }),
  );
  const topics = confirmed.flatMap((result) => result.topics);
  return { topics, tokens: confirmed.reduce((total, result) => total + result.tokens, 0) };
}

/**
 * Keeps the `limit` likeliest labels. Only names are sent, as the fenced part of the state, so a
 * hostile name is data. An answer selects a label, and never adds one.
 */
export async function rankTopics(
  names: string[],
  labels: string[],
  model: ResolvedModel,
  { limit, concurrency }: { limit: number; concurrency: number },
): Promise<{ topics: RankedTopic[]; tokens: number }> {
  const state: FileState = {
    text: names.join('\n'),
    images: [],
    metadata: { kind: 'folder listing' },
    warnings: [],
  };
  const run = pLimit(concurrency);
  const ask: Ask = (questions) => run(() => askQuestions(state, questions, model));
  const { maxQuestions } = model.caps;
  const swept = await sweep(labels, Math.min(maxQuestions, GROUPS_PER_REQUEST), ask);
  const perRequest = Math.min(maxQuestions, BOOLEANS_PER_REQUEST);
  const { topics, tokens } = await confirm(swept.shortlist, perRequest, ask);
  return {
    topics: topics
      .filter((topic) => topic.probability >= FLOOR)
      .toSorted((a, b) => b.probability - a.probability || a.value.localeCompare(b.value))
      .slice(0, limit),
    tokens: swept.tokens + tokens,
  };
}
