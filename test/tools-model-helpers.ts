/**
 * Mock models for the tool tests that reach a provider. A test file replaces the providers module
 * with `mockedProviders`, then steers both models through `modelMock` and reads back what they
 * were asked.
 */
import {
  convertArrayToReadableStream,
  Experimental_DecisionMockModelV4 as MockDecisionModel,
  MockLanguageModelV4,
} from 'ai/test';
import type * as Providers from '../src/ai/providers.ts';

/** One call to the decision model, as recorded. */
interface DecisionRequest {
  /** How many questions the call held. */
  questionCount: number;
  /** The state it was sent, as JSON. */
  stateJson: string;
}

/** What the mock models answer, and what they were asked. */
interface ModelMock {
  /** What the chat model replies to every call, sent as JSON text. */
  chatReply: object;
  /** The odds the decision model gives the text of a choice option, or a yes/no question as JSON. */
  oddsOf: (questionOrOptionText: string) => number;
  /** Every call to the decision model, in order. */
  decisionRequests: DecisionRequest[];
  /** How many times the chat model was called. */
  chatCalls: number;
}

/** A mock that replies with an empty object, gives every question odds of 0.9, and has no calls. */
const freshModelMock = (): ModelMock => ({
  chatReply: {},
  oddsOf: () => 0.9,
  decisionRequests: [],
  chatCalls: 0,
});

/** The state the mock models read and record into. Tests steer it, and reset it before each. */
export const modelMock: ModelMock = freshModelMock();

/** Puts `modelMock` back to a fresh mock. */
export function resetModelMock(): void {
  Object.assign(modelMock, freshModelMock());
}

/** How many questions the decision model was asked, over all calls. */
export function questionsAsked(): number {
  let total = 0;
  for (const request of modelMock.decisionRequests) total += request.questionCount;
  return total;
}

/** The 903 topics of a mock catalog: three named ones, then 900 fillers. */
export const CATALOG_TOPICS = [
  'finance/budgeting',
  'nature/python',
  'technology/python',
  ...Array.from({ length: 900 }, (_, index) => `science/filler-${index}`),
];

/** The parts of a decision question the mock reads: its type and, for a choice, its options. */
interface Question {
  type: string;
  criteria: Record<string, string>;
}

/**
 * Answers a choice as the real decision model does: each option gets its share of the mock odds, so
 * the probabilities sum to 1, and the likeliest option is the choice.
 */
function answerChoice(criteria: Record<string, string>) {
  const oddsByOption = Object.entries(criteria).map(
    ([option, text]) => [option, modelMock.oddsOf(text)] as const,
  );
  const totalOdds = oddsByOption.reduce((sum, [, odds]) => sum + odds, 0);
  const shareByOption = oddsByOption.map(([option, odds]) => [option, odds / totalOdds] as const);
  const byShareDescending = shareByOption.toSorted(([, shareA], [, shareB]) => shareB - shareA);
  const likeliestOption = byShareDescending[0]?.[0] ?? 'other';
  return {
    type: 'choice' as const,
    choice: likeliestOption,
    probabilities: Object.fromEntries(shareByOption),
  };
}

/** Answers one question at the mock odds: a choice option by option, a yes/no question as a whole. */
function answerAtMockOdds(question: unknown) {
  const { type, criteria } = question as Question;
  if (type === 'choice') return answerChoice(criteria);
  const probability = modelMock.oddsOf(JSON.stringify(question));
  return { type: 'boolean' as const, probability };
}

/** The usage a chat reply reports: one token in and one out. */
const ONE_TOKEN_EACH_WAY = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

/** The parts of a streamed reply of `text`, ending with its usage. */
const streamedReply = (text: string) => [
  { type: 'text-start' as const, id: 't' },
  { type: 'text-delta' as const, id: 't', delta: text },
  { type: 'text-end' as const, id: 't' },
  {
    type: 'finish' as const,
    finishReason: { unified: 'stop' as const, raw: undefined },
    usage: ONE_TOKEN_EACH_WAY,
  },
];

/** A chat model that sends `modelMock.chatReply`, whole or streamed, and counts its calls. */
const replyingChatModel = () =>
  new MockLanguageModelV4({
    doStream: async () => {
      modelMock.chatCalls++;
      return {
        stream: convertArrayToReadableStream(streamedReply(JSON.stringify(modelMock.chatReply))),
      };
    },
    doGenerate: async () => {
      modelMock.chatCalls++;
      const replyText = JSON.stringify(modelMock.chatReply);
      const stopped = { unified: 'stop' as const, raw: undefined };
      return {
        content: [{ type: 'text', text: replyText }],
        finishReason: stopped,
        usage: ONE_TOKEN_EACH_WAY,
        warnings: [],
      };
    },
  });

/** A decision model that answers at `modelMock.oddsOf`, spends 10 tokens in and 2 out, and records each call. */
const recordingDecisionModel = () =>
  new MockDecisionModel({
    doDecide: async ({ questions, state }) => {
      const questionCount = Object.keys(questions).length;
      modelMock.decisionRequests.push({ questionCount, stateJson: JSON.stringify(state) });
      const answerById = Object.entries(questions).map(([id, question]) => [
        id,
        answerAtMockOdds(question),
      ]);
      const answers = Object.fromEntries(answerById);
      return { answers, usage: { inputTokens: 10, outputTokens: 2 }, warnings: [] };
    },
  });

/** The real providers module, with both model resolvers returning the mock models. */
export function mockedProviders(real: typeof Providers): typeof Providers {
  const caps = real.capabilities('openai', 'gpt-6-luna');
  const chatModel = replyingChatModel();
  const decisionModel = recordingDecisionModel();
  // Both resolve as OpenAI, the default provider, so the code under test takes its usual path.
  const openaiFields = { provider: 'openai', caps } as const;
  return {
    ...real,
    resolveChatModel: async () => ({ ...openaiFields, model: chatModel, modelId: 'm' }),
    resolveModel: async () => ({ ...openaiFields, model: decisionModel, modelId: 'gpt-6-luna' }),
  };
}
