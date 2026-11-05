import { expect, test } from 'vitest';
import { configSchema } from '../src/core/config.ts';
import { isEnabled, loadFacets, toQuestions } from '../src/core/facets.ts';
import { useTempHome } from './helpers.ts';

useTempHome();
const config = configSchema.parse({});
const PACKS = [
  'core',
  'time',
  'parties',
  'projects',
  'finance',
  'legal',
  'sensitivity',
  'media',
  'work',
  'housekeeping',
];

async function load() {
  const warnings: string[] = [];
  const facets = await loadFacets(config, (message) => warnings.push(message));
  return { facets, warnings };
}

test('all 100 presets load, 10 per pack, with unique ids', async () => {
  const { facets, warnings } = await load();
  expect(warnings).toEqual([]);
  expect(facets).toHaveLength(100);
  expect(new Set(facets.map((facet) => facet.id)).size).toBe(100);
  for (const pack of PACKS) {
    expect(facets.filter((facet) => facet.pack === pack)).toHaveLength(10);
  }
});

test('every question stays inside provider limits', async () => {
  const questions = (await load()).facets.flatMap((facet) => Object.values(toQuestions(facet)));
  const sizes = (type: string) =>
    questions.flatMap((question) =>
      question.type === type && 'criteria' in question ? Object.keys(question.criteria).length : [],
    );
  expect(Math.max(...sizes('choice'))).toBeLessThanOrEqual(255);
  expect(Math.min(...sizes('score'))).toBeGreaterThanOrEqual(2);
  expect(Math.max(...sizes('score'))).toBeLessThanOrEqual(10);
});

test('the default packs fit Clef in one request', async () => {
  const enabled = (await load()).facets.filter((facet) => isEnabled(facet, config));
  const questions = enabled.flatMap((facet) => Object.keys(toQuestions(facet)));
  expect(questions.length).toBeLessThanOrEqual(64);
});

test('every level defines each of its steps in the instructions', async () => {
  for (const facet of (await load()).facets) {
    for (const level of facet.levels ?? []) expect(facet.instructions).toContain(`${level}:`);
  }
});

test('only topic, party and project are open, and only topic has seeds', async () => {
  const open = (await load()).facets.filter((facet) => facet.open);
  expect(open.map((facet) => facet.id).toSorted()).toEqual(['party', 'project', 'topic']);
  expect(open.filter((facet) => Object.keys(facet.values ?? {}).length > 0)).toHaveLength(1);
});

test('all of sensitivity is biased to review, and nothing claims a file is safe', async () => {
  const { facets } = await load();
  for (const facet of facets.filter(({ pack }) => pack === 'sensitivity')) {
    expect(facet).toMatchObject({ weight: 0.25, apply_above: 0.95 });
  }
  const labels = facets.flatMap((f) => [...Object.keys(f.values ?? {}), ...(f.levels ?? [])]);
  expect(labels.filter((label) => /safe/.test(label))).toEqual([]);
});

test('every scale that can fail to apply starts at none, and public-or-not is explicit', async () => {
  const { facets } = await load();
  const levels = facets.filter((facet) => facet.kind === 'level');
  expect(levels.map((facet) => facet.id).toSorted()).toEqual(
    [
      'amount',
      'confidentiality',
      'importance',
      'quality',
      'retention',
      'technical-depth',
    ].toSorted(),
  );
  for (const facet of levels) expect(facet.levels?.[0]).toBe('none');
  const visibility = facets.find((facet) => facet.id === 'visibility');
  expect(visibility).toMatchObject({ kind: 'choice', pack: 'sensitivity' });
  expect(Object.keys(visibility?.values ?? {})).toEqual(['public', 'private']);
});

test('the requested metadata and sensitivity facets exist with the documented kinds', async () => {
  const kind = new Map((await load()).facets.map((facet) => [facet.id, facet.kind]));
  for (const id of ['author', 'year', 'month', 'fiscal-year', 'is-screenshot']) {
    expect(kind.get(id)).toBe('field');
  }
  expect(kind.get('confidentiality')).toBe('level');
  expect(kind.get('audience')).toBe('choice');
});
