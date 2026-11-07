import { describe, expect, test } from 'vitest';
import { type Config, configSchema } from '../src/core/config.ts';
import { resolve } from '../src/core/answer-tags.ts';
import type { Answer } from '../src/types.ts';
import { choice, field, flag, level, multi } from './facets-helpers.ts';

const config = configSchema.parse({});

/** A file holding no tags and with none rejected. */
const noTags = { existing: [], rejected: [] };
/** The facets most tests resolve against. */
const facets = [flag, choice, multi, level, field('author', 'author')];

/** A fresh, not estimated, not refused answer. */
const answer = (facet: string, value: string | null, confidence: number | null): Answer => ({
  facet,
  value,
  confidence,
  estimated: false,
  refused: false,
});

/** Resolves answers against `facets` and the default config. */
const run = (answers: Answer[], existing: string[] = [], rejected: string[] = []) =>
  resolve(answers, facets, config, { existing, rejected });

/** The default config with other thresholds. */
const withThresholds = (thresholds: Partial<Config['thresholds']>): Config => ({
  ...config,
  thresholds: { ...config.thresholds, ...thresholds },
});

describe('resolve thresholds', () => {
  test('by default nothing at or above 0.5 waits for a person', () => {
    expect(run([answer('kind', 'a', 0.5)])).toEqual({ apply: ['kind:a'], review: [] });
  });

  test('a raised thresholds.apply brings back the review band', () => {
    const banded = withThresholds({ apply: 0.85 });
    const at = (p: number) => resolve([answer('kind', 'a', p)], facets, banded, noTags);
    expect(at(0.85).apply).toEqual(['kind:a']);
    expect(at(0.84).review).toEqual([{ tag: 'kind:a', confidence: 0.84 }]);
    expect(at(0.5).review).toHaveLength(1);
  });

  test('a confident answer applies, and one below 0.49 is dropped', () => {
    expect(run([answer('kind', 'a', 0.85)]).apply).toEqual(['kind:a']);
    expect(run([answer('kind', 'a', 0.49)])).toEqual({ apply: [], review: [] });
  });

  test('a label with no confidence waits for a person', () => {
    expect(run([answer('kind', 'a', null)]).review).toEqual([{ tag: 'kind:a', confidence: null }]);
  });

  test('no value, a refusal, or a facet that is gone writes nothing', () => {
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
    const estimated = { ...answer('has-x', 'yes', 0.99), estimated: true };
    expect(run([estimated]).apply).toEqual([]);
    expect(run([estimated]).review).toHaveLength(1);
    const trusting = withThresholds({ estimated_to_review: false });
    expect(resolve([estimated], facets, trusting, noTags).apply).toEqual(['flag:has-x']);
  });
});

describe('resolve against tags already decided', () => {
  const sure = [answer('kind', 'a', 0.99)];

  test('skips a rejected tag and a tag already held', () => {
    expect(run(sure, [], ['kind:a'])).toEqual({ apply: [], review: [] });
    expect(run(sure, ['kind:a'])).toEqual({ apply: [], review: [] });
  });

  test('skips a single-valued facet a person set, and not a multi one', () => {
    expect(run(sure, ['kind:b'])).toEqual({ apply: [], review: [] });
    expect(run([answer('topic', 'a', 0.99)], ['topic:b/c']).apply).toEqual(['topic:a']);
  });

  test('aliases are mapped before every check', () => {
    const aliased = [{ ...choice, aliases: { a: 'b' } }];
    const applied = (existing: string[], rejected: string[]) =>
      resolve(sure, aliased, config, { existing, rejected }).apply;
    expect(applied([], [])).toEqual(['kind:b']);
    expect(applied([], ['kind:b'])).toEqual([]);
    expect(applied(['kind:b'], [])).toEqual([]);
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
    const heavyChoice = { ...choice, weight: 2 };
    const ranked = [heavyChoice, flag, level];
    const tight = { ...config, max_tags: 3 };
    const answers = [
      answer('lvl', 'low', 0.9),
      answer('has-x', 'yes', 0.95),
      answer('kind', 'a', 0.86),
    ];
    const holdingOne = { existing: ['mine'], rejected: [] };
    expect(resolve(answers, ranked, tight, holdingOne).apply).toEqual(['kind:a', 'flag:has-x']);
    const holdingFour = { existing: ['a', 'b', 'c', 'd'], rejected: [] };
    expect(resolve(answers, ranked, tight, holdingFour).apply).toEqual([]);
  });

  test('a capped tag is dropped, not reviewed', () => {
    const tight = { ...config, max_tags: 1 };
    const answers = [answer('has-x', 'yes', 0.95), answer('kind', 'a', 0.9)];
    expect(resolve(answers, facets, tight, noTags)).toEqual({ apply: ['flag:has-x'], review: [] });
  });
});

/** What applies when the metadata gives `author:ann`, against the tags the file holds and rejects. */
const appliedWithAuthorAnn = (existing: string[], rejected: string[] = []) =>
  resolve([], facets, config, { existing, rejected, derived: ['author:ann'] }).apply;

describe('resolve field tags', () => {
  test('field tags apply at confidence 1, unless held otherwise or rejected', () => {
    expect(appliedWithAuthorAnn([])).toEqual(['author:ann']);
    expect(appliedWithAuthorAnn(['author:bob'])).toEqual([]);
    expect(appliedWithAuthorAnn([], ['author:ann'])).toEqual([]);
  });

  test('a field flag applies as a flag tag', () => {
    const flagged = [{ ...field('is-shot', 'screenshot') }];
    const derived = { ...noTags, derived: ['flag:is-shot'] };
    expect(resolve([], flagged, config, derived).apply).toEqual(['flag:is-shot']);
  });

  test('field tags come first under max_tags', () => {
    const tight = { ...config, max_tags: 1 };
    const derived = { ...noTags, derived: ['author:ann'] };
    const applied = resolve([answer('kind', 'a', 0.99)], facets, tight, derived).apply;
    expect(applied).toEqual(['author:ann']);
  });
});
