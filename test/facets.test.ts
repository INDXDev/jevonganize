import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { configSchema, paths } from '../src/core/config.ts';
import { facetHash, toQuestions } from '../src/core/facet-questions.ts';
import {
  appliesTo,
  isEnabled,
  loadFacets,
  tagFacet,
  tagFor,
  withVocabulary,
} from '../src/core/facets.ts';
import type { Facet } from '../src/types.ts';
import { choice, date, field, flag, level, multi } from './facets-helpers.ts';
import { useTempHome } from './helpers.ts';

useTempHome();
const config = configSchema.parse({});

describe('facetHash', () => {
  test('hashes a facet once, since estimate asks for every file', () => {
    let reads = 0;
    const counted: Facet = {
      ...choice,
      get values() {
        reads++;
        return choice.values;
      },
    };
    expect(facetHash(counted)).toBe(facetHash(choice));
    const once = reads;
    facetHash(counted);
    expect(reads).toBe(once);
  });
});

describe('tagFacet', () => {
  test('reads the facet from any tag shape', () => {
    expect(tagFacet('doc-type:invoice')).toBe('doc-type');
    expect(tagFacet('flag:has-x')).toBe('has-x');
    expect(tagFacet('plain')).toBe('');
  });
});

const custom = (name: string, text: string) => {
  mkdirSync(paths.facetsDir(), { recursive: true });
  writeFileSync(join(paths.facetsDir(), name), text);
};

describe('loadFacets', () => {
  const good = `pack = "home"\ntitle = "Home"\n[[facet]]\nid = "doc-type"\ntitle = "Mine"\nkind = "flag"\ninstructions = "Q?"\n`;

  test('a custom facet replaces a preset with its id', async () => {
    custom('home.toml', good);
    const facets = await loadFacets(config);
    expect(facets.find((facet) => facet.id === 'doc-type')?.title).toBe('Mine');
    expect(facets).toHaveLength(102);
  });

  test('a bad file warns and leaves the others alone', async () => {
    custom('a-broken.toml', 'pack = ');
    custom('home.toml', good);
    const warnings: string[] = [];
    const facets = await loadFacets(config, (message) => warnings.push(message));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('a-broken.toml');
    expect(facets.find((facet) => facet.id === 'doc-type')?.title).toBe('Mine');
  });

  test.each([
    ['the id flag', 'id = "flag"\nkind = "flag"\ninstructions = "Q?"'],
    ['a key of another kind', 'id = "x"\nkind = "flag"\ninstructions = "Q?"\nlevels = ["a", "b"]'],
    [
      'a reserved label',
      'id = "x"\nkind = "choice"\ninstructions = "Q?"\n[facet.values]\nother = "O."',
    ],
    ['a bad label', 'id = "x"\nkind = "choice"\ninstructions = "Q?"\n[facet.values]\n"a,b" = "O."'],
    ['one level', 'id = "x"\nkind = "level"\ninstructions = "Q?"\nlevels = ["a"]'],
    ['a closed multi with no values', 'id = "x"\nkind = "multi"\ninstructions = "Q?"'],
  ])('skips a facet with %s, and keeps its neighbour', async (_, body) => {
    custom(
      'bad.toml',
      `pack = "x"\ntitle = "X"\n[[facet]]\nid = "fine"\ntitle = "F"\nkind = "flag"\ninstructions = "Q?"\n[[facet]]\ntitle = "T"\n${body}\n`,
    );
    const warnings: string[] = [];
    const facets = await loadFacets(config, (message) => warnings.push(message));
    expect(warnings).toHaveLength(1);
    expect(facets.some((facet) => facet.id === 'fine')).toBe(true);
    expect(facets).toHaveLength(103);
  });

  test('a duplicate id in one folder is skipped', async () => {
    custom(
      'a.toml',
      `pack = "a"\ntitle = "A"\n[[facet]]\nid = "dup"\ntitle = "1"\nkind = "flag"\ninstructions = "Q?"\n`,
    );
    custom(
      'b.toml',
      `pack = "b"\ntitle = "B"\n[[facet]]\nid = "dup"\ntitle = "2"\nkind = "flag"\ninstructions = "Q?"\n`,
    );
    const warnings: string[] = [];
    const facets = await loadFacets(config, (message) => warnings.push(message));
    expect(warnings).toHaveLength(1);
    expect(facets.find((facet) => facet.id === 'dup')?.title).toBe('1');
  });
});

test('isEnabled takes packs or ids, and disabled wins', () => {
  const facets = { enabled: ['p'], disabled: ['has-x'] };
  expect(isEnabled(flag, { facets })).toBe(false);
  expect(isEnabled(choice, { facets })).toBe(true);
  expect(isEnabled({ ...choice, pack: 'q' }, { facets })).toBe(false);
});

test('appliesTo matches MIME globs, and empty means every file', () => {
  expect(appliesTo(flag, 'x/y')).toBe(true);
  expect(appliesTo({ ...flag, applies_to: ['image/*'] }, 'image/png')).toBe(true);
  expect(appliesTo({ ...flag, applies_to: ['image/*'] }, 'text/plain')).toBe(false);
  expect(appliesTo({ ...flag, applies_to: ['text/plain'] }, 'text/plain')).toBe(true);
});

test('withVocabulary merges active values and removes retired ones, on open facets only', () => {
  const db = {
    listVocabulary: () => [
      { facet: 'topic', value: 'new', state: 'active' as const },
      { facet: 'topic', value: 'a', state: 'retired' as const },
      { facet: 'topic', value: 'maybe', state: 'proposed' as const },
      { facet: 'kind', value: 'c', state: 'active' as const },
    ],
  };
  const [open, closed] = withVocabulary([multi, choice], db);
  expect(open?.values).toEqual({ 'b/c': 'C.', new: 'The file clearly concerns "new".' });
  expect(closed).toBe(choice);
});

describe('toQuestions', () => {
  test('flag, level and field', () => {
    expect(toQuestions(flag)).toEqual({ 'has-x': { type: 'boolean', instructions: 'Q?' } });
    expect(toQuestions(level).lvl).toMatchObject({ type: 'score', criteria: level.levels });
    expect(toQuestions(field('author', 'author'))).toEqual({});
  });

  test('choice offers other', () => {
    const question = toQuestions(choice).kind;
    expect(question?.type === 'choice' && Object.keys(question.criteria)).toEqual([
      'a',
      'b',
      'other',
    ]);
  });

  test('multi asks one boolean per label, and an empty open facet asks nothing', () => {
    expect(Object.keys(toQuestions(multi))).toEqual(['topic.a', 'topic.b/c']);
    expect(toQuestions(multi)['topic.a']?.instructions).toBe('Q?\na: A.');
    expect(toQuestions({ ...multi, values: {} })).toEqual({});
  });

  test('date asks a fixed span of years, then months only at month precision', () => {
    const questions = toQuestions(date);
    const year = questions['when.year'];
    expect(year?.type === 'choice' && Object.keys(year.criteria)).toContain('2039');
    expect(year?.type === 'choice' && Object.keys(year.criteria)).toHaveLength(51);
    const month = questions['when.month'];
    expect(month?.type === 'choice' && Object.keys(month.criteria)).toHaveLength(13);
    expect(Object.keys(toQuestions({ ...date, precision: 'year' }))).toEqual(['when.year']);
  });
});

test('facetHash covers only what the model sees', () => {
  const hash = facetHash(choice);
  expect(facetHash({ ...choice, weight: 3, title: 'x', aliases: { z: 'a' } })).toBe(hash);
  expect(facetHash({ ...choice, apply_above: 0.9, applies_to: ['a/*'] })).toBe(hash);
  expect(facetHash({ ...choice, instructions: 'Other?' })).not.toBe(hash);
  expect(facetHash({ ...choice, values: { a: 'A!', b: 'B.' } })).not.toBe(hash);
});

test('tagFor', () => {
  expect(tagFor(flag, 'yes')).toBe('flag:has-x');
  expect(tagFor(choice, 'a')).toBe('kind:a');
});
