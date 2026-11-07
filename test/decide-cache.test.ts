import { describe, expect, test, vi } from 'vitest';
import { decide } from '../src/ai/decide.ts';
import { capabilities } from '../src/ai/providers.ts';
import type { Facet } from '../src/types.ts';
import {
  answersYes,
  apiError,
  askedInCall,
  authorField,
  type DoDecide,
  fileState,
  flagFacet,
  flagFacets,
  memoryStore,
  mockModel,
} from './decide-helpers.ts';

/** An open multi facet whose vocabulary is still empty, so there is nothing to ask. */
const emptyOpenFacet: Facet = { ...flagFacet('party'), kind: 'multi', open: true, values: {} };

describe('cache', () => {
  test('a second run is free and returns the same answers', async () => {
    const { spy, model } = mockModel();
    const store = memoryStore();

    const first = await decide({ state: fileState() }, [flagFacet('a')], model, store);
    const second = await decide({ state: fileState() }, [flagFacet('a')], model, store);

    expect(first).toMatchObject({ tokens: { input: 10, output: 0 }, cached: 0 });
    expect(second).toMatchObject({ tokens: { input: 0, output: 0 }, cached: 1 });
    expect(second.answers).toEqual(first.answers);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('adding a facet asks only that facet', async () => {
    const { spy, model } = mockModel();
    const store = memoryStore();
    await decide({ state: fileState() }, [flagFacet('a')], model, store);

    const withB = await decide({ state: fileState() }, flagFacets('a', 'b'), model, store);

    expect(withB.cached).toBe(1);
    expect(askedInCall(spy, 1)).toEqual(['b']);
  });

  test('field facets and empty open facets cost nothing', async () => {
    const { spy, model } = mockModel();

    const facets = [authorField, emptyOpenFacet];
    const result = await decide({ state: fileState() }, facets, model, memoryStore());

    expect(result).toMatchObject({
      answers: [],
      tokens: { input: 0, output: 0 },
      cached: 0,
      warnings: [],
    });
    expect(spy).not.toHaveBeenCalled();
  });

  test('identical content in flight is asked once', async () => {
    const { spy, model } = mockModel();
    const store = memoryStore();
    const ask = () => decide({ state: fileState() }, [flagFacet('a')], model, store);

    const [one, two] = await Promise.all([ask(), ask()]);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(two.answers).toEqual(one.answers);
    expect(one.cached + two.cached).toBe(1);
  });
});

describe('cache after a failure', () => {
  test('a failed request leaves nothing behind, so a retry asks again', async () => {
    const failOnce = vi
      .fn<DoDecide>()
      .mockRejectedValueOnce(apiError(400))
      .mockImplementation(answersYes);
    const { model } = mockModel(failOnce);
    const store = memoryStore();
    const ask = () => decide({ state: fileState() }, [flagFacet('a')], model, store);

    await expect(ask()).rejects.toThrow('no');
    expect(store.rows.size).toBe(0);
    await expect(ask()).resolves.toBeTruthy();
  });

  test('a later chunk failing keeps the answers already paid for', async () => {
    const caps = { ...capabilities('openai', 'x'), maxQuestions: 2 };
    const secondChunkFails = vi
      .fn<DoDecide>()
      .mockImplementationOnce(answersYes)
      .mockRejectedValueOnce(apiError(500))
      .mockImplementation(answersYes);
    const { spy, model } = mockModel(secondChunkFails, caps);
    const store = memoryStore();
    const ask = () => decide({ state: fileState() }, flagFacets('a', 'b', 'c'), model, store);

    await expect(ask()).rejects.toThrow('no');
    expect(store.rows.size).toBe(2);
    const retry = await ask();

    expect(retry.cached).toBe(2);
    expect(askedInCall(spy, 2)).toEqual(['c']);
  });
});

describe('reading the cache', () => {
  test.each([
    ['a label that is not on offer', { value: 'z' }],
    ['a confidence outside 0 to 1', { confidence: 7 }],
  ])('%s is a miss, so it is asked again', async (_name, damage) => {
    const { spy, model } = mockModel();
    const store = memoryStore();
    const ask = () => decide({ state: fileState() }, [flagFacet('a')], model, store);
    await ask();
    const [key = '', [row] = []] = [...store.rows].at(0) ?? [];
    store.rows.set(key, [{ ...row!, ...damage }]);

    const { answers, cached } = await ask();

    expect(spy).toHaveBeenCalledTimes(2);
    expect(cached).toBe(0);
    expect(answers).toMatchObject([{ value: 'yes' }]);
  });
});
