import type { TokenUsage } from '../src/ai/pricing.ts';
import { Experimental_DecisionRefusalError, RetryError } from 'ai';
import { describe, expect, test } from 'vitest';
import { decide } from '../src/ai/decide.ts';
import { askQuestions } from '../src/ai/questions.ts';
import { UserError } from '../src/core/config.ts';
import {
  apiError,
  askedInCall,
  type CallOptions,
  fileState,
  flagFacet,
  flagFacets,
  memoryStore,
  mockModel,
  refusing,
  yesToAll,
} from './decide-helpers.ts';

/** Refuses question `b` when asked, and is billed 10 tokens either way. */
const billedRefusalOfB = async ({ questions }: CallOptions) => ({
  answers: {
    ...yesToAll(questions),
    ...('b' in questions ? { b: { type: 'refusal' as const } } : {}),
  },
  usage: { inputTokens: 10 },
  warnings: [],
});

/** A model that always rejects with this error. */
const rejectingWith = (error: Error) => mockModel(() => Promise.reject(error));

describe('refusals', () => {
  test('retries without the refused questions and records them', async () => {
    const { spy, model } = mockModel(refusing(['b']));
    const store = memoryStore();

    const { answers } = await decide({ state: fileState() }, flagFacets('a', 'b'), model, store);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(askedInCall(spy, 1)).toEqual(['a']);
    const answerTo = (facet: string) => answers.find((row) => row.facet === facet);
    expect(answerTo('a')).toMatchObject({ value: 'yes', refused: false });
    expect(answerTo('b')).toMatchObject({ value: null, refused: true });
    expect(store.rows.size).toBe(2);
  });

  test('refusing everything still ends, with every question recorded', async () => {
    const { spy, model } = mockModel(refusing(['a', 'b']));

    const facets = flagFacets('a', 'b');
    const { answers } = await decide({ state: fileState() }, facets, model, memoryStore());

    expect(spy).toHaveBeenCalledTimes(1);
    expect(answers.every((row) => row.refused)).toBe(true);
  });

  test('a refusal naming nothing we asked fails the file instead of looping', async () => {
    const strayRefusal = new Experimental_DecisionRefusalError({
      questionIds: ['zzz'],
      provider: 'p',
      modelId: 'm',
    });
    const { spy, model } = rejectingWith(strayRefusal);

    const run = decide({ state: fileState() }, [flagFacet('a')], model, memoryStore());

    await expect(run).rejects.toBe(strayRefusal);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('tokens', () => {
  test('a refused call still counts: the provider billed it', async () => {
    const { model } = mockModel(billedRefusalOfB);

    const facets = flagFacets('a', 'b');
    const { tokens } = await decide({ state: fileState() }, facets, model, memoryStore());

    expect(tokens).toEqual({ input: 20, output: 0 });
  });

  test('a call that failed later still reaches onTokens', async () => {
    let calls = 0;
    const failsOnRetry = async (options: CallOptions) => {
      calls++;
      if (calls > 1) throw apiError(400);
      return billedRefusalOfB(options);
    };
    const { model } = mockModel(failsOnRetry);
    const reported: TokenUsage[] = [];
    const onTokens = (tokens: TokenUsage) => void reported.push(tokens);

    const run = decide(
      { state: fileState(), onTokens },
      flagFacets('a', 'b'),
      model,
      memoryStore(),
    );

    await expect(run).rejects.toThrow('no');
    expect(reported).toEqual([{ input: 10, output: 0 }]);
  });
});

describe('errors', () => {
  test.each([401, 403])('HTTP %i becomes a UserError that stops the job', async (status) => {
    const { model } = rejectingWith(apiError(status));

    const run = decide({ state: fileState() }, [flagFacet('a')], model, memoryStore());

    await expect(run).rejects.toBeInstanceOf(UserError);
    await expect(run).rejects.toThrow(String(status));
  });

  test('a rejected key seen through retries is still a UserError', async () => {
    const retriedRejection = new RetryError({
      message: 'm',
      reason: 'maxRetriesExceeded',
      errors: [apiError(401)],
    });
    const { model } = rejectingWith(retriedRejection);

    const questions = { a: { type: 'boolean' as const, instructions: 'Q?' } };
    const run = askQuestions(fileState(), questions, model);

    await expect(run).rejects.toBeInstanceOf(UserError);
  });

  test('any other error stays as it is, failing only this file', async () => {
    const badRequest = apiError(400);
    const { model } = rejectingWith(badRequest);

    const run = decide({ state: fileState() }, [flagFacet('a')], model, memoryStore());

    await expect(run).rejects.toBe(badRequest);
    await expect(run).rejects.not.toBeInstanceOf(UserError);
  });
});
