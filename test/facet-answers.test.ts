import { describe, expect, test } from 'vitest';
import { configSchema } from '../src/core/config.ts';
import { derive, fromAnswers, resolve, validAnswer } from '../src/core/facet-answers.ts';
import type { Answer, Facet, FileState } from '../src/types.ts';
import { base, choice, date, field, flag, level, multi } from './facets-helpers.ts';

const config = configSchema.parse({});

const cachedRow = (value: string | null, confidence: number | null = 0.9): Answer => ({
  facet: 'kind',
  value,
  confidence,
  estimated: false,
  refused: false,
});

describe('validAnswer', () => {
  test('takes a current label, or no value, with confidence in 0 to 1', () => {
    expect(validAnswer(choice, cachedRow('a'))).toBe(true);
    expect(validAnswer(choice, cachedRow(null, null))).toBe(true);
    expect(validAnswer(flag, { ...cachedRow('yes'), facet: 'has-x' })).toBe(true);
    const dated: Facet = { ...base, id: 'kind', kind: 'date' };
    expect(validAnswer(dated, cachedRow('2026-03'))).toBe(true);
    const scale: Facet = { ...base, id: 'kind', kind: 'level', levels: ['low', 'high'] };
    expect(validAnswer(scale, cachedRow('high'))).toBe(true);
  });

  test('refuses a label not on offer, a bad confidence, or another facet', () => {
    expect(validAnswer(choice, cachedRow('z'))).toBe(false);
    expect(validAnswer(choice, cachedRow('a', 1.5))).toBe(false);
    expect(validAnswer(choice, cachedRow('a', -0.1))).toBe(false);
    expect(validAnswer(flag, cachedRow('yes'))).toBe(false);
    expect(validAnswer({ ...base, id: 'kind', kind: 'date' }, cachedRow('../etc'))).toBe(false);
  });
});

const answer = (facet: string, value: string | null, confidence: number | null): Answer => ({
  facet,
  value,
  confidence,
  estimated: false,
  refused: false,
});
const state = (metadata: FileState['metadata']): FileState => ({
  text: '',
  images: [],
  metadata,
  warnings: [],
});

const rawChoice = (choice_: string) => ({
  kind: { type: 'choice' as const, choice: choice_, probabilities: { [choice_]: 0.7 } },
});
const pick = (value: string, p?: number) => ({
  type: 'choice' as const,
  choice: value,
  ...(p !== undefined && { probabilities: { [value]: p } }),
});

describe('fromAnswers by kind', () => {
  test('flag gives yes with P(true)', () => {
    const [row] = fromAnswers(flag, { 'has-x': { type: 'boolean', probability: 0.2 } });
    expect(row).toMatchObject({ value: 'yes', confidence: 0.2, refused: false });
  });

  test('choice maps other and unknown labels to no value', () => {
    expect(fromAnswers(choice, rawChoice('a'))[0]).toMatchObject({ value: 'a', confidence: 0.7 });
    expect(fromAnswers(choice, rawChoice('other'))[0]).toMatchObject({
      value: null,
      confidence: 0.7,
    });
    expect(fromAnswers(choice, rawChoice('made-up'))[0]?.value).toBeNull();
    expect(
      fromAnswers(choice, { kind: { type: 'choice', choice: 'a' } })[0]?.confidence,
    ).toBeNull();
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

describe('fromAnswers for scales and dates', () => {
  test('level rounds the score and uses that level probability', () => {
    const [row] = fromAnswers(level, {
      lvl: { type: 'score', score: 1.6, probabilities: { 0: 0.1, 1: 0.2, 2: 0.7 } },
    });
    expect(row).toMatchObject({ value: 'high', confidence: 0.7 });
    expect(fromAnswers(level, { lvl: { type: 'score', score: 9 } })[0]).toMatchObject({
      value: 'high',
      confidence: null,
    });
  });

  test('a level labelled none writes no tag', () => {
    const scale: Facet = { ...level, levels: ['none', 'low'] };
    const rows = fromAnswers(scale, {
      lvl: { type: 'score', score: 0, probabilities: { 0: 0.99, 1: 0.01 } },
    });
    expect(rows).toEqual([expect.objectContaining({ value: null, refused: false })]);
    expect(resolve(rows, [scale], configSchema.parse({}), noTags)).toEqual({
      apply: [],
      review: [],
    });
  });

  test('date joins year and month at the lower probability', () => {
    const of = (year: ReturnType<typeof pick>, month: ReturnType<typeof pick>) =>
      fromAnswers(date, { 'when.year': year, 'when.month': month })[0];
    expect(of(pick('2026', 0.9), pick('03', 0.6))).toMatchObject({
      value: '2026-03',
      confidence: 0.6,
    });
    expect(of(pick('2026', 0.9), pick('other', 0.6))).toMatchObject({
      value: '2026',
      confidence: 0.9,
    });
    expect(of(pick('other', 0.9), pick('03', 0.6))?.value).toBeNull();
    expect(of(pick('2026'), pick('03'))).toMatchObject({ value: '2026-03', confidence: null });
    expect(fromAnswers(date, { 'when.year': { type: 'refusal' } })[0]?.refused).toBe(true);
  });
});

describe('fromAnswers refusals', () => {
  test('a refused or missing answer is recorded as refused', () => {
    expect(fromAnswers(flag, { 'has-x': { type: 'refusal' } })[0]?.refused).toBe(true);
    expect(fromAnswers(flag, {})[0]?.refused).toBe(true);
    expect(fromAnswers(level, {})[0]?.refused).toBe(true);
    expect(fromAnswers(choice, {})[0]?.refused).toBe(true);
    expect(fromAnswers(field('a', 'a'), {})).toEqual([]);
  });
});

describe('derive', () => {
  const created = '2026-03-15T10:00:00Z';
  test.each([
    ['year', 'year:2026'],
    ['month', 'month:2026-03'],
    ['fiscal-year', 'fiscal-year:FY2025'],
  ] as const)('format %s', (format, tag) => {
    expect(derive(field(format, 'created', format), state({ created }), config)).toBe(tag);
  });

  test('a fiscal year starts at fiscal_year_start', () => {
    const fy = field('fiscal-year', 'created', 'fiscal-year');
    expect(derive(fy, state({ created: '2026-04-01' }), config)).toBe('fiscal-year:FY2026');
    const calendar = { ...config, fiscal_year_start: 1 };
    expect(derive(fy, state({ created }), calendar)).toBe('fiscal-year:FY2026');
  });

  test('a date that does not parse gives no tag', () => {
    const year = field('year', 'created', 'year');
    expect(derive(year, state({ created: 'yesterday' }), config)).toBeNull();
    expect(derive(year, state({ created: '2026-13-45' }), config)).toBeNull();
    expect(derive(field('m', 'created', 'month'), state({ created: '2026' }), config)).toBeNull();
    expect(derive(year, state({}), config)).toBeNull();
  });

  test('booleans write a flag or nothing', () => {
    const shot = field('is-screenshot', 'screenshot');
    expect(derive(shot, state({ screenshot: true }), config)).toBe('flag:is-screenshot');
    expect(derive(shot, state({ screenshot: false }), config)).toBeNull();
  });

  test('values are cleaned, so a hostile file cannot break the grammar', () => {
    const author = field('author', 'author');
    expect(derive(author, state({ author: 'Doe, Jane' }), config)).toBe('author:doe-jane');
    expect(derive(author, state({ author: 'a/b‮;"c\n' }), config)).toBe('author:a-b-c');
    expect(derive(author, state({ author: ' ,;* ' }), config)).toBeNull();
    const long = derive(author, state({ author: 'x'.repeat(100) }), config);
    expect(long).toHaveLength(64);
  });

  test('only the first recipient of `to` counts', () => {
    const to = field('recipient', 'to');
    expect(derive(to, state({ to: 'Ann Lee, Bob' }), config)).toBe('recipient:ann-lee');
  });

  test('a facet of another kind derives nothing', () => {
    expect(derive(flag, state({ 'has-x': true }), config)).toBeNull();
  });
});

const noTags = { existing: [], rejected: [] };
const facets = [flag, choice, multi, level, field('author', 'author')];
const run = (answers: Answer[], existing: string[] = [], rejected: string[] = []) =>
  resolve(answers, facets, config, { existing, rejected });

describe('resolve thresholds', () => {
  test('by default nothing at or above 0.5 waits for a person', () => {
    expect(run([answer('kind', 'a', 0.5)])).toEqual({ apply: ['kind:a'], review: [] });
  });

  test('a raised thresholds.apply brings back the review band', () => {
    const banded = { ...config, thresholds: { ...config.thresholds, apply: 0.85 } };
    const at = (p: number) =>
      resolve([answer('kind', 'a', p)], facets, banded, { existing: [], rejected: [] });
    expect(at(0.85).apply).toEqual(['kind:a']);
    expect(at(0.84).review).toEqual([{ tag: 'kind:a', confidence: 0.84 }]);
    expect(at(0.5).review).toHaveLength(1);
  });

  test('walks the threshold table', () => {
    expect(run([answer('kind', 'a', 0.85)]).apply).toEqual(['kind:a']);
    expect(run([answer('kind', 'a', 0.49)])).toEqual({ apply: [], review: [] });
    expect(run([answer('kind', 'a', null)]).review).toEqual([{ tag: 'kind:a', confidence: null }]);
    expect(run([answer('kind', null, 0.99)])).toEqual({ apply: [], review: [] });
    expect(run([{ ...answer('kind', 'a', 0.99), refused: true }]).apply).toEqual([]);
    expect(run([answer('gone', 'a', 0.99)]).apply).toEqual([]);
  });

  test('apply_above biases sensitive facets to review', () => {
    const sensitive = [{ ...flag, apply_above: 0.95 }];
    const at = (p: number) => resolve([answer('has-x', 'yes', p)], sensitive, config, noTags);
    expect(at(0.94).review).toHaveLength(1);
    expect(at(0.94).apply).toEqual([]);
    expect(at(0.95).apply).toEqual(['flag:has-x']);
  });

  test('estimated answers wait for a person unless turned off', () => {
    const row = { ...answer('has-x', 'yes', 0.99), estimated: true };
    expect(run([row]).apply).toEqual([]);
    expect(run([row]).review).toHaveLength(1);
    const open = { ...config, thresholds: { ...config.thresholds, estimated_to_review: false } };
    expect(resolve([row], facets, open, noTags).apply).toEqual(['flag:has-x']);
  });
});

describe('resolve against tags already decided', () => {
  test('skips rejected tags, tags already held, and single-valued facets a person set', () => {
    expect(run([answer('kind', 'a', 0.99)], [], ['kind:a'])).toEqual({ apply: [], review: [] });
    expect(run([answer('kind', 'a', 0.99)], ['kind:a'])).toEqual({ apply: [], review: [] });
    expect(run([answer('kind', 'a', 0.99)], ['kind:b'])).toEqual({ apply: [], review: [] });
    expect(run([answer('topic', 'a', 0.99)], ['topic:b/c']).apply).toEqual(['topic:a']);
  });

  test('aliases are mapped before every check', () => {
    const aliased = [{ ...choice, aliases: { a: 'b' } }];
    const go = (existing: string[], rejected: string[]) =>
      resolve([answer('kind', 'a', 0.99)], aliased, config, { existing, rejected }).apply;
    expect(go([], [])).toEqual(['kind:b']);
    expect(go([], ['kind:b'])).toEqual([]);
    expect(go(['kind:b'], [])).toEqual([]);
  });
});

describe('resolve limits', () => {
  test('each multi keeps its top three labels', () => {
    const values = Object.fromEntries(['a', 'b', 'c', 'd'].map((label) => [label, 'V.']));
    const wide = [{ ...multi, values }];
    const answers = [
      answer('topic', 'a', 0.9),
      answer('topic', 'b', 0.99),
      answer('topic', 'c', 0.95),
      answer('topic', 'd', 0.97),
    ];
    expect(resolve(answers, wide, config, noTags).apply).toEqual(['topic:b', 'topic:d', 'topic:c']);
  });

  test('max_tags ranks by weight, then confidence, then text, and counts held tags', () => {
    const heavy = { ...choice, weight: 2 };
    const set = [heavy, flag, level];
    const tight = { ...config, max_tags: 3 };
    const answers = [
      answer('lvl', 'low', 0.9),
      answer('has-x', 'yes', 0.95),
      answer('kind', 'a', 0.86),
    ];
    expect(resolve(answers, set, tight, { existing: ['mine'], rejected: [] }).apply).toEqual([
      'kind:a',
      'flag:has-x',
    ]);
    expect(
      resolve(answers, set, tight, { existing: ['a', 'b', 'c', 'd'], rejected: [] }).apply,
    ).toEqual([]);
  });

  test('a capped tag is dropped, not reviewed', () => {
    const tight = { ...config, max_tags: 1 };
    const answers = [answer('has-x', 'yes', 0.95), answer('kind', 'a', 0.9)];
    expect(resolve(answers, facets, tight, noTags)).toEqual({ apply: ['flag:has-x'], review: [] });
  });
});

describe('resolve field tags', () => {
  test('field tags apply at confidence 1, under the same rules', () => {
    const derived = (existing: string[], rejected: string[] = []) =>
      resolve([], facets, config, { existing, rejected, derived: ['author:ann'] }).apply;
    expect(derived([])).toEqual(['author:ann']);
    expect(derived(['author:bob'])).toEqual([]);
    expect(derived([], ['author:ann'])).toEqual([]);
    const flagged = [{ ...field('is-shot', 'screenshot') }];
    expect(resolve([], flagged, config, { ...noTags, derived: ['flag:is-shot'] }).apply).toEqual([
      'flag:is-shot',
    ]);
    const tight = { ...config, max_tags: 1 };
    const answers = [answer('kind', 'a', 0.99)];
    expect(resolve(answers, facets, tight, { ...noTags, derived: ['author:ann'] }).apply).toEqual([
      'author:ann',
    ]);
  });
});
