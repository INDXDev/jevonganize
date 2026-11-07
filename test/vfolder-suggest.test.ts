import { beforeEach, expect, test, vi } from 'vitest';
import { callTool } from '../src/core/tools.ts';
import { suggestTags } from '../src/core/vfolder-suggest.ts';
import { readableName, ruleKey } from '../src/core/vfolder-suggest-folders.ts';
import type { VfolderTagQuery, VfolderTagSuggestions } from '../src/tool-map.ts';
import { as, ctx, idOf, root, setupToolContext } from './tools-helpers.ts';
import { applyPlan, save, tagged } from './vfolders-helpers.ts';

setupToolContext();

/**
 * Seven files. Under `topic:finance`, `party:acme` and both years sit on two files each, so they
 * narrow it; `party:beta` and the child `topic:finance/tax` sit on one, so they do not.
 */
const LIBRARY = {
  'a.pdf': ['topic:finance', 'year:2024', 'party:acme'],
  'b.pdf': ['topic:finance', 'year:2024', 'party:acme'],
  'c.pdf': ['topic:finance', 'year:2025', 'party:beta'],
  'd.pdf': ['topic:finance', 'year:2025'],
  'e.pdf': ['topic:law', 'year:2024'],
  'f.pdf': ['topic:finance/tax'],
  'g.pdf': ['topic:finance/tax/vat'],
};

const FINANCE: VfolderTagQuery = { tags: ['topic:finance'], tag_match: 'all' };

beforeEach(async () => {
  // Suggestions are statistics only: any network call would be a bug.
  vi.stubGlobal('fetch', () => Promise.reject(new Error('no network in suggestions')));
  await tagged(LIBRARY);
});

/** Calls `suggest_vfolder_tags` as the person at the CLI. */
const suggestTagsFor = (input: VfolderTagQuery) => callTool('suggest_vfolder_tags', input, ctx);
/** The tags offered, in order. */
const suggestedTags = ({ suggestions }: VfolderTagSuggestions) =>
  suggestions.map((suggestion) => suggestion.tag);

test('tags that narrow the rule come first as narrows, rarer ones ahead on a tie', async () => {
  const result = await suggestTagsFor(FINANCE);
  expect(result.matches).toBe(6);
  // year:2024 is also on e.pdf, so its idf is lower; the other two tie and go by code point.
  expect(result.suggestions).toEqual([
    { tag: 'party:acme', facet: 'party', count: 2, with_rule: 2, reason: 'narrows' },
    { tag: 'year:2025', facet: 'year', count: 2, with_rule: 2, reason: 'narrows' },
    { tag: 'year:2024', facet: 'year', count: 3, with_rule: 2, reason: 'narrows' },
  ]);
});

test('a tag in the rule, an excluded tag and a retired value are never offered', async () => {
  await callTool('set_vocabulary', { facet: 'party', value: 'acme', state: 'retired' }, ctx);
  const excluded = await suggestTagsFor({ ...FINANCE, exclude_tags: ['party:beta'] });
  // Without c.pdf, year:2025 is on one file of the rule, so only year:2024 narrows it.
  expect(suggestedTags(excluded)).toEqual(['year:2024']);
  // Not even as favorites, which skip the statistics.
  const favorites = ['party:beta', 'party:acme', 'topic:finance', 'topic:law'];
  const rule = { ...FINANCE, exclude_tags: ['party:beta'] };
  expect(suggestedTags(suggestTags(ctx.db, rule, favorites))).toEqual(['year:2024', 'topic:law']);
  const empty = await suggestTagsFor({ tags: [], tag_match: 'any', exclude_tags: ['topic:law'] });
  expect(empty.suggestions.every(({ reason }) => reason === 'common')).toBe(true);
  expect(suggestedTags(empty)).not.toContain('party:acme');
  expect(suggestedTags(empty)).not.toContain('topic:law');
  expect(suggestedTags(empty)[0]).toBe('topic:finance');
});

test('the order is deterministic, and limit cuts it', async () => {
  const first = await suggestTagsFor({ tags: [], tag_match: 'all' });
  const again = await suggestTagsFor({ tags: [], tag_match: 'all' });
  expect(again).toEqual(first);
  // With no tags in the rule: by how many files carry each, then by code point.
  expect(suggestedTags(first)).toEqual([
    'topic:finance',
    'year:2024',
    'party:acme',
    'year:2025',
    'party:beta',
    'topic:finance/tax',
    'topic:finance/tax/vat',
    'topic:law',
  ]);
  const one = await suggestTagsFor({ tags: [], tag_match: 'all', limit: 1 });
  expect(suggestedTags(one)).toEqual(['topic:finance']);
  await expect(suggestTagsFor({ ...FINANCE, limit: 51 })).rejects.toThrow('suggest_vfolder_tags');
});

test('matches equals the search_files total for the same rule', async () => {
  const rules: VfolderTagQuery[] = [
    FINANCE,
    { tags: ['year:2024', 'year:2025'], tag_match: 'any', exclude_tags: ['topic:law'] },
    { tags: ['topic:finance'], tag_match: 'all', text: 'a.pdf' },
    { tags: [], tag_match: 'all', folder: root },
  ];
  for (const rule of rules) {
    const { matches } = await suggestTagsFor(rule);
    const { limit: _limit, ...query } = rule;
    expect(matches).toBe((await callTool('search_files', query, ctx)).total);
  }
});

test('tags applied plans added come as recent, and favorites before them', async () => {
  const plan = await callTool(
    'propose_changes',
    { file_ids: [idOf('e.pdf')], add: ['project:apollo'], title: 'p' },
    ctx,
  );
  await applyPlan(plan.id);
  const result = await suggestTagsFor(FINANCE);
  expect(result.suggestions.at(-1)).toEqual({
    tag: 'project:apollo',
    facet: 'project',
    count: 1,
    with_rule: 0,
    reason: 'recent',
  });
  for (const tag of ['party:beta', 'project:apollo', 'nowhere']) {
    await callTool('set_favorite_tag', { tag, favorite: true }, ctx);
  }
  const withFavorites = (await suggestTagsFor(FINANCE)).suggestions.slice(3);
  expect(withFavorites).toEqual([
    { tag: 'party:beta', facet: 'party', count: 1, with_rule: 1, reason: 'favorite' },
    { tag: 'project:apollo', facet: 'project', count: 1, with_rule: 0, reason: 'favorite' },
    { tag: 'nowhere', facet: null, count: 0, with_rule: 0, reason: 'favorite' },
  ]);
});

test('a model may ask for suggestions without approval', async () => {
  await expect(suggestTagsFor(FINANCE)).resolves.toBeDefined();
  await expect(callTool('suggest_vfolders', {}, as('mcp'))).resolves.not.toEqual([]);
  await expect(callTool('suggest_vfolder_tags', FINANCE, as('chat'))).resolves.toBeDefined();
});

test('suggest_vfolders yields large tags, pairs and namespaces in turn, with readable names', async () => {
  const suggestions = await callTool('suggest_vfolders', { limit: 30 }, ctx);
  // The namespace topic:finance would come third, but it is the same rule as the large tag.
  expect(suggestions.slice(0, 3).map(({ reason }) => reason)).toEqual([
    'large-tag',
    'pair',
    'large-tag',
  ]);
  expect(suggestions[0]).toEqual({
    name: 'finance',
    rule: { tags: ['topic:finance'], tag_match: 'all', exclude_tags: [] },
    count: 6,
    reason: 'large-tag',
  });
  const pairs = suggestions.filter(({ reason }) => reason === 'pair');
  expect(pairs.map(({ name }) => name)).toContain('acme × 2024');
  const acme = pairs.find(({ name }) => name === 'acme × 2024')!;
  expect(acme).toMatchObject({ rule: { tags: ['party:acme', 'year:2024'] }, count: 2 });
  const parents = suggestions.filter(({ reason }) => reason === 'namespace');
  expect(parents.map(({ name, rule }) => [name, rule.tags])).toEqual([
    ['finance / tax', ['topic:finance/tax']],
  ]);
});

test('suggest_vfolders leaves out a rule a saved folder already has', async () => {
  await save({ name: 'Money', rule: { tags: ['topic:finance'], tag_match: 'any' } });
  await save({ name: 'Acme 2024', rule: { tags: ['year:2024', 'party:acme'], tag_match: 'all' } });
  const suggestions = await callTool('suggest_vfolders', { limit: 30 }, ctx);
  const keys = suggestions.map(({ rule }) => ruleKey(rule));
  expect(keys).not.toContain(
    ruleKey({ tags: ['topic:finance'], tag_match: 'all', exclude_tags: [] }),
  );
  expect(suggestions.map(({ name }) => name)).not.toContain('acme × 2024');
  expect(new Set(keys).size).toBe(keys.length);
  const again = await callTool('suggest_vfolders', { limit: 30 }, ctx);
  expect(again).toEqual(suggestions);
  expect(await callTool('suggest_vfolders', { limit: 2 }, ctx)).toHaveLength(2);
});

test('suggest_vfolders: a pair needs lift above 1, and a retired value is never offered', async () => {
  await callTool('set_vocabulary', { facet: 'party', value: 'acme', state: 'retired' }, ctx);
  await tagged({
    'n1.txt': ['kind:note', 'year:2024'],
    'n2.txt': ['kind:note', 'year:2024'],
    'n3.txt': ['kind:note'],
    'n4.txt': ['kind:note'],
    'n5.txt': ['kind:note'],
    'n6.txt': ['kind:note'],
  });
  const suggestions = await callTool('suggest_vfolders', { limit: 30 }, ctx);
  const tags = suggestions.flatMap(({ rule }) => rule.tags);
  expect(tags).not.toContain('party:acme');
  // kind:note sits on 6 of 13 files and year:2024 on 5: 2 together is below chance.
  const names = suggestions.map(({ name }) => name);
  expect(names).not.toContain('note × 2024');
  expect(names).toContain('finance × 2025');
});

test('readable names drop the namespace and space out the levels', () => {
  expect(readableName('topic:finance/tax')).toBe('finance / tax');
  expect(readableName('to-read')).toBe('to-read');
  expect(readableName('a/b')).toBe('a / b');
  expect(readableName('entity:Acme Corp')).toBe('Acme Corp');
});
