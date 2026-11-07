/**
 * Picks the catalog topics that fit a folder, out of every topic in the catalog, in two rounds:
 * a cheap sweep where labels compete in large choice questions, then a yes-or-no question for each
 * label on the shortlist.
 */
import type { TokenUsage } from './pricing.ts';
import pLimit from 'p-limit';
import type { FileState } from '../types.ts';
import type { ResolvedModel } from './providers.ts';
import { askQuestions } from './questions.ts';

/** Options per choice question, since `other` makes the 255 providers allow. */
const GROUP_SIZE = 254;
/** Keeps a request near 20k tokens, inside Jev's 32k even though Jev sets no question limit. */
const GROUPS_PER_REQUEST = 8;
/** A question costs about 155 tokens before its text, so only a shortlist gets one of its own. */
const SHORTLIST_SIZE = 1000;
/** Yes-or-no questions per request in the second round. */
const CONFIRMATIONS_PER_REQUEST = 400;
/** Below this the model is saying no, so a short list beats a padded one. */
const MIN_PROBABILITY = 0.5;

/** Every question opens by saying what the fenced text is. */
const LISTING = 'The file names listed below come from one folder.';
const CHOICE_INSTRUCTIONS = `${LISTING} Which one of these subjects best describes specific content found in some of those files? Choose other if none is specific to them.`;
const NONE_OF_THESE = 'None of these is specific to the files.';
const confirmInstructions = (label: string) =>
  `${LISTING} Would "${label}" be a useful tag for some of them? Answer no if it only describes files or text in general, or would fit almost any folder.`;

/** One topic the model thinks fits, with how sure it is. */
export interface RankedTopic {
  value: string;
  probability: number;
}

/** Asks a set of questions about the listing, within the concurrency limit. */
type AskListing = (
  questions: Parameters<typeof askQuestions>[1],
) => ReturnType<typeof askQuestions>;
/** The topics some requests scored, and the tokens they billed. */
type ScoredTopics = { topics: RankedTopic[]; tokens: TokenUsage };

/** Question and option ids are positions, so a label never reaches the model as an id. */
const groupId = (index: number) => `g${index}`;
const optionId = (index: number) => `c${index}`;
const labelId = (index: number) => `t${index}`;

/** Splits items into lists of at most `size`, in order. */
const chunked = <T>(items: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );

/** Tokens of several requests added up. */
const sumTokens = (tokens: TokenUsage[]): TokenUsage => ({
  input: tokens.reduce((total, each) => total + each.input, 0),
  output: tokens.reduce((total, each) => total + each.output, 0),
});

/** Joins the results of parallel requests. */
const mergeRequests = (results: ScoredTopics[]): ScoredTopics => ({
  topics: results.flatMap((result) => result.topics),
  tokens: sumTokens(results.map((result) => result.tokens)),
});

const byProbability = (a: RankedTopic, b: RankedTopic) => b.probability - a.probability;
/** Ties break by name, so a run gives the same order every time. */
const byProbabilityThenName = (a: RankedTopic, b: RankedTopic) =>
  byProbability(a, b) || a.value.localeCompare(b.value);

/** One choice question per group of labels, with `other` for none of them. */
function choiceQuestion(group: string[]) {
  const options = Object.fromEntries(group.map((label, index) => [optionId(index), label]));
  const criteria = { ...options, other: NONE_OF_THESE };
  return { type: 'choice' as const, instructions: CHOICE_INSTRUCTIONS, criteria };
}

/** Asks one request's groups, and scores every label by its option's probability. */
async function askChoiceRequest(groups: string[][], askListing: AskListing): Promise<ScoredTopics> {
  const questions = Object.fromEntries(
    groups.map((group, index) => [groupId(index), choiceQuestion(group)]),
  );
  const { answers, tokens } = await askListing(questions);
  const topics = groups.flatMap((group, groupIndex) => {
    const answer = answers[groupId(groupIndex)];
    if (answer?.type !== 'choice') return [];
    // A provider that gives no distribution is sure of its one choice.
    const probabilityByOption = answer.probabilities ?? { [answer.choice]: 1 };
    return group.map((label, index) => ({
      value: label,
      probability: probabilityByOption[optionId(index)] ?? 0,
    }));
  });
  return { topics, tokens };
}

/** Every label competes in a choice question. Each option's probability ranks it in the shortlist. */
async function sweepForShortlist(
  labels: string[],
  groupsPerRequest: number,
  askListing: AskListing,
) {
  const requests = chunked(chunked(labels, GROUP_SIZE), groupsPerRequest);
  const scored = await Promise.all(
    requests.map(async (groups) => askChoiceRequest(groups, askListing)),
  );
  const { topics, tokens } = mergeRequests(scored);
  const shortlist = topics
    .filter((topic) => topic.probability > 0)
    .toSorted(byProbability)
    .slice(0, SHORTLIST_SIZE)
    .map((topic) => topic.value);
  return { shortlist, tokens };
}

/** A yes-or-no question on whether one label suits the folder. */
const confirmQuestion = (label: string) => ({
  type: 'boolean' as const,
  instructions: confirmInstructions(label),
});

/** Asks one yes-or-no question per label. */
async function askConfirmRequest(labels: string[], askListing: AskListing): Promise<ScoredTopics> {
  const questions = Object.fromEntries(
    labels.map((label, index) => [labelId(index), confirmQuestion(label)]),
  );
  const { answers, tokens } = await askListing(questions);
  const topics = labels.flatMap((label, index) => {
    const answer = answers[labelId(index)];
    return answer?.type === 'boolean' ? [{ value: label, probability: answer.probability }] : [];
  });
  return { topics, tokens };
}

/** Judges each shortlisted label alone, which also removes the ones that only won a weak group. */
async function confirmEach(
  labels: string[],
  labelsPerRequest: number,
  askListing: AskListing,
): Promise<ScoredTopics> {
  const requests = chunked(labels, labelsPerRequest);
  const scored = await Promise.all(
    requests.map(async (batch) => askConfirmRequest(batch, askListing)),
  );
  return mergeRequests(scored);
}

/** The folder's file names, as the fenced text of a state with nothing else in it. */
const folderListing = (names: string[]): FileState => ({
  text: names.join('\n'),
  images: [],
  metadata: { kind: 'folder listing' },
  warnings: [],
});

/** How many topics to keep, how many requests at once, and who hears each billed request. */
interface RankOptions {
  limit: number;
  concurrency: number;
  onTokens?: (tokens: TokenUsage) => void;
}

/**
 * Keeps the `limit` likeliest labels. Only names are sent, as the fenced part of the state, so a
 * hostile name is data. An answer selects a label, and never adds one.
 */
export async function rankTopics(
  names: string[],
  labels: string[],
  model: ResolvedModel,
  { limit, concurrency, onTokens }: RankOptions,
): Promise<{ topics: RankedTopic[]; tokens: TokenUsage }> {
  const listing = folderListing(names);
  const withinConcurrency = pLimit(concurrency);
  const askListing: AskListing = (questions) =>
    withinConcurrency(() => askQuestions(listing, questions, model, { onTokens }));
  const { maxQuestions } = model.caps;
  const groupsPerRequest = Math.min(maxQuestions, GROUPS_PER_REQUEST);
  const labelsPerRequest = Math.min(maxQuestions, CONFIRMATIONS_PER_REQUEST);

  const swept = await sweepForShortlist(labels, groupsPerRequest, askListing);
  const confirmed = await confirmEach(swept.shortlist, labelsPerRequest, askListing);
  const topics = confirmed.topics
    .filter((topic) => topic.probability >= MIN_PROBABILITY)
    .toSorted(byProbabilityThenName)
    .slice(0, limit);
  return { topics, tokens: sumTokens([swept.tokens, confirmed.tokens]) };
}
