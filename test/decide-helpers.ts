/** Shared builders of the decide tests: facets, file states, a mocked model and an answer store. */
import { APICallError } from 'ai';
import { Experimental_DecisionMockModelV4 as MockDecisionModel } from 'ai/test';
import { vi } from 'vitest';
import { capabilities, type ResolvedModel } from '../src/ai/providers.ts';
import type { Answer, Facet, FileState } from '../src/types.ts';

/** The model call the tests replace. */
export type DoDecide = MockDecisionModel['doDecide'];
/** What one model call was sent. */
export type CallOptions = Parameters<DoDecide>[0];
type Questions = CallOptions['questions'];

/** A yes-or-no facet with this id. */
export const flagFacet = (id: string): Facet => ({
  id,
  pack: 'p',
  title: 't',
  kind: 'flag',
  instructions: 'Q?',
  applies_to: [],
  weight: 1,
});

/** Yes-or-no facets with these ids. */
export const flagFacets = (...ids: string[]) => ids.map(flagFacet);

/** A facet read from file metadata, which needs no model. */
export const authorField: Facet = { ...flagFacet('author'), kind: 'field', field: 'author' };

/** A small JPEG, as an extractor hands it over. */
export const jpeg = { data: new Uint8Array([1, 2]), mediaType: 'image/jpeg', source: 'file' };

/** What an extractor read from `a.txt`, with one local warning that must never be sent. */
export const fileState = (text = 'body', images: FileState['images'] = []): FileState => ({
  text,
  images,
  metadata: { name: 'a.txt', size: 3 },
  warnings: ['local only'],
});

/** Answers every question yes, with 0.9. */
export const yesToAll = (questions: Questions) =>
  Object.fromEntries(
    Object.keys(questions).map((id) => [id, { type: 'boolean' as const, probability: 0.9 }]),
  );

/** A model call that answers yes to all, billed 10 tokens. */
export const answersYes: DoDecide = async ({ questions }) => ({
  answers: yesToAll(questions),
  usage: { inputTokens: 10 },
  warnings: [],
});

/** A model call that refuses the questions with these ids and answers yes to the rest. */
export const refusing =
  (refusedIds: string[]): DoDecide =>
  async ({ questions }) => {
    const asked = refusedIds.filter((id) => id in questions);
    const refusals = Object.fromEntries(asked.map((id) => [id, { type: 'refusal' as const }]));
    return { answers: { ...yesToAll(questions), ...refusals }, warnings: [] };
  };

/** A resolved model whose calls go to a spy around `doDecide`. */
export function mockModel(
  doDecide: DoDecide = answersYes,
  caps = capabilities('openai', 'gpt-6-luna'),
) {
  const spy = vi.fn<DoDecide>(doDecide);
  const model: ResolvedModel = {
    model: new MockDecisionModel({ doDecide: spy }),
    provider: 'openai',
    modelId: 'gpt-6-luna',
    caps,
  };
  return { spy, model };
}

/** The spy of a mocked model. */
export type ModelSpy = ReturnType<typeof mockModel>['spy'];

/** An answer store in memory, with its rows open to the test. */
export function memoryStore() {
  const rows = new Map<string, Answer[]>();
  return {
    rows,
    getAnswer: (key: string) => rows.get(key),
    putAnswer: (key: string, _facet: string, body: Answer[]) => void rows.set(key, body),
  };
}

/** What the model was sent in its call number `index`, counting from 0. */
export function sentInCall(spy: ModelSpy, index = 0): CallOptions {
  const options = spy.mock.calls[index]?.[0];
  if (!options) throw new Error('no such call');
  return options;
}

/** The question ids the model was asked in call number `index`. */
export const askedInCall = (spy: ModelSpy, index = 0) =>
  Object.keys(sentInCall(spy, index).questions);

/** A provider error with this HTTP status. */
export const apiError = (statusCode: number) =>
  new APICallError({
    message: 'no',
    url: 'u',
    requestBodyValues: {},
    statusCode,
    isRetryable: false,
  });
