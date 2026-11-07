import { describe, expect, test } from 'vitest';
import { configSchema } from '../src/core/config.ts';
import { resolve } from '../src/core/answer-tags.ts';
import { fromAnswers, validAnswer } from '../src/core/facet-answers.ts';
import type { Answer, Facet } from '../src/types.ts';
import { base, choice, date, field, flag, level, multi } from './facets-helpers.ts';

/** A stored answer to the `kind` facet, as the cache returns it. */
const kindAnswer = (value: string | null, confidence: number | null = 0.9): Answer => ({
  facet: 'kind',
  value,
  confidence,
  estimated: false,
  refused: false,
});

/** A model's raw pick of a choice label, with an optional probability for it. */
const pick = (label: string, probability?: number) => ({
  type: 'choice' as const,
  choice: label,
  ...(probability !== undefined && { probabilities: { [label]: probability } }),
});

/** The raw answer to the `kind` question that picks `label` at 0.7. */
const kindPicks = (label: string) => ({ kind: pick(label, 0.7) });

/** A `kind` facet that is a date, and one that is a two-step scale. */
const kindDate: Facet = { ...base, id: 'kind', kind: 'date' };
const kindScale: Facet = { ...base, id: 'kind', kind: 'level', levels: ['low', 'high'] };

describe('validAnswer', () => {
  test('takes a current label, or no value, with confidence in 0 to 1', () => {
    expect(validAnswer(choice, kindAnswer('a'))).toBe(true);
    expect(validAnswer(choice, kindAnswer(null, null))).toBe(true);
    expect(validAnswer(flag, { ...kindAnswer('yes'), facet: 'has-x' })).toBe(true);
    expect(validAnswer(kindDate, kindAnswer('2026-03'))).toBe(true);
    expect(validAnswer(kindScale, kindAnswer('high'))).toBe(true);
  });

  test('refuses a label not on offer, a bad confidence, or another facet', () => {
    expect(validAnswer(choice, kindAnswer('z'))).toBe(false);
    expect(validAnswer(choice, kindAnswer('a', 1.5))).toBe(false);
    expect(validAnswer(choice, kindAnswer('a', -0.1))).toBe(false);
    expect(validAnswer(flag, kindAnswer('yes'))).toBe(false);
    expect(validAnswer(kindDate, kindAnswer('../etc'))).toBe(false);
  });
});

describe('fromAnswers by kind', () => {
  test('flag gives yes with P(true)', () => {
    const [row] = fromAnswers(flag, { 'has-x': { type: 'boolean', probability: 0.2 } });

    expect(row).toMatchObject({ value: 'yes', confidence: 0.2, refused: false });
  });

  test('choice keeps a label on offer, with its probability', () => {
    expect(fromAnswers(choice, kindPicks('a'))[0]).toMatchObject({ value: 'a', confidence: 0.7 });
    expect(fromAnswers(choice, { kind: pick('a') })[0]?.confidence).toBeNull();
  });

  test('choice maps other and unknown labels to no value', () => {
    const other = fromAnswers(choice, kindPicks('other'))[0];
    expect(other).toMatchObject({ value: null, confidence: 0.7 });
    expect(fromAnswers(choice, kindPicks('made-up'))[0]?.value).toBeNull();
  });

  test('multi gives one answer per label, keeping a partial refusal', () => {
    const rows = fromAnswers(multi, {
      'topic.a': { type: 'boolean', probability: 0.9 },
      'topic.b/c': { type: 'refusal' },
    });

    expect(rows[0]).toMatchObject({ value: 'a', confidence: 0.9 });
    expect(rows[1]).toMatchObject({ value: null, refused: true });
  });
});

describe('fromAnswers for scales', () => {
  test('level rounds the score and uses that level probability', () => {
    const probabilities = { 0: 0.1, 1: 0.2, 2: 0.7 };

    const [row] = fromAnswers(level, { lvl: { type: 'score', score: 1.6, probabilities } });

    expect(row).toMatchObject({ value: 'high', confidence: 0.7 });
  });

  test('a score past the top is the top level, with no confidence', () => {
    const [row] = fromAnswers(level, { lvl: { type: 'score', score: 9 } });

    expect(row).toMatchObject({ value: 'high', confidence: null });
  });

  test('a level labelled none writes no tag', () => {
    const scale: Facet = { ...level, levels: ['none', 'low'] };
    const probabilities = { 0: 0.99, 1: 0.01 };

    const rows = fromAnswers(scale, { lvl: { type: 'score', score: 0, probabilities } });

    expect(rows).toEqual([expect.objectContaining({ value: null, refused: false })]);
    const config = configSchema.parse({});
    const resolved = resolve(rows, [scale], config, { existing: [], rejected: [] });
    expect(resolved).toEqual({ apply: [], review: [] });
  });
});

describe('fromAnswers for dates', () => {
  type Pick = ReturnType<typeof pick>;
  const dateOf = (year: Pick, month: Pick) =>
    fromAnswers(date, { 'when.year': year, 'when.month': month })[0];

  test('date joins year and month at the lower probability', () => {
    expect(dateOf(pick('2026', 0.9), pick('03', 0.6))).toMatchObject({
      value: '2026-03',
      confidence: 0.6,
    });
    expect(dateOf(pick('2026'), pick('03'))).toMatchObject({ value: '2026-03', confidence: null });
  });

  test('an unknown month leaves the year, and an unknown year leaves nothing', () => {
    expect(dateOf(pick('2026', 0.9), pick('other', 0.6))).toMatchObject({
      value: '2026',
      confidence: 0.9,
    });
    expect(dateOf(pick('other', 0.9), pick('03', 0.6))?.value).toBeNull();
  });

  test('a refused year refuses the date', () => {
    expect(fromAnswers(date, { 'when.year': { type: 'refusal' } })[0]?.refused).toBe(true);
  });
});

describe('fromAnswers refusals', () => {
  test('a refused or missing answer is recorded as refused', () => {
    expect(fromAnswers(flag, { 'has-x': { type: 'refusal' } })[0]?.refused).toBe(true);
    expect(fromAnswers(flag, {})[0]?.refused).toBe(true);
    expect(fromAnswers(level, {})[0]?.refused).toBe(true);
    expect(fromAnswers(choice, {})[0]?.refused).toBe(true);
  });

  test('a field facet asks nothing, so it records nothing', () => {
    expect(fromAnswers(field('a', 'a'), {})).toEqual([]);
  });
});
