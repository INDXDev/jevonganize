/**
 * Suggestions for virtual folders, from the index's tag statistics alone. Nothing here calls a
 * model, so nothing leaves the machine. `suggestTags` offers tags for the rule a person is building;
 * the folders worth saving are in vfolder-suggest-folders.ts. Every order is deterministic, with
 * ties broken by the tag in code point order. See docs/contracts.md#suggesting-folders.
 */
import type { FileQuery, Tag } from '../types.ts';
import type {
  VfolderTagQuery,
  VfolderTagReason,
  VfolderTagSuggestion,
  VfolderTagSuggestions,
} from '../tool-map.ts';
import type { Db, RuleTagRow } from './db.ts';

/** How many tags `suggest_vfolder_tags` offers unless asked, and at most. */
export const TAG_LIMITS = { fallback: 12, max: 50 } as const;
/** A tag must sit on this many files of the rule to narrow it. */
const MIN_NARROWING = 2;
/** How many of the newest applied plans give `recent` tags. */
const RECENT_PLANS = 20;

/** Code point order, the same on every machine and in every locale. */
export const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Retired values of open facets, as tags. They are never offered again. */
export function retiredTags(db: Db): Set<Tag> {
  const retired = db.listVocabulary().filter((entry) => entry.state === 'retired');
  return new Set(retired.map((entry) => `${entry.facet}:${entry.value}`));
}

/** The rule being built, as a `FileQuery` with only the fields it sets. */
function ruleQuery(input: VfolderTagQuery): FileQuery {
  const { tags, tag_match, exclude_tags, folder, text } = input;
  return {
    tags,
    tag_match,
    ...(exclude_tags?.length && { exclude_tags }),
    ...(folder !== undefined && { folder }),
    ...(text !== undefined && { text }),
  };
}

/** What `suggest_vfolder_tags` returns. `favorites` are the person's favorite tags, in order. */
export function suggestTags(
  db: Db,
  input: VfolderTagQuery,
  favorites: readonly Tag[],
): VfolderTagSuggestions {
  const query = ruleQuery(input);
  const matches = db.countFiles(query);
  const inRule = db.ruleTagCounts(query);
  const hasTags = input.tags.length > 0;
  const recent = recentTags(db);
  const lookup = tagLookup(db, inRule, [...favorites, ...recent]);
  const candidates = [
    ...(hasTags ? narrowing(inRule, matches) : []),
    ...pick(favorites, 'favorite', lookup),
    ...pick(recent, 'recent', lookup).filter((suggestion) => suggestion.count > 0),
    ...(hasTags ? [] : common(inRule)),
  ];
  const blocked = new Set([...input.tags, ...(input.exclude_tags ?? []), ...retiredTags(db)]);
  const limit = Math.min(input.limit ?? TAG_LIMITS.fallback, TAG_LIMITS.max);
  return { matches, suggestions: firstOfEach(candidates, blocked).slice(0, limit) };
}

/** Each tag once, under the first reason it got, leaving out the blocked ones. */
function firstOfEach(
  candidates: VfolderTagSuggestion[],
  blocked: Set<Tag>,
): VfolderTagSuggestion[] {
  const seen = new Set(blocked);
  return candidates.filter(({ tag }) => !seen.has(tag) && Boolean(seen.add(tag)));
}

/** A tag's counts, by name: from the rule's own rows, else from the index with none in the rule. */
type TagLookup = (tag: Tag) => Omit<VfolderTagSuggestion, 'reason'>;

/** Looks up every tag the rule's rows do not already cover in one query. */
function tagLookup(db: Db, inRule: RuleTagRow[], wanted: Tag[]): TagLookup {
  const known = new Map(
    inRule.map(({ tag, facet, count, with_rule }) => [tag, { facet, count, with_rule }]),
  );
  const missing = [...new Set(wanted)].filter((tag) => !known.has(tag));
  for (const { tag, facet, count } of db.tagStats(missing))
    known.set(tag, { facet, count, with_rule: 0 });
  return (tag) => ({ tag, ...(known.get(tag) ?? { facet: null, count: 0, with_rule: 0 }) });
}

/** These tags, in order, as suggestions with one reason. */
const pick = (tags: readonly Tag[], reason: VfolderTagReason, lookup: TagLookup) =>
  tags.map((tag) => ({ ...lookup(tag), reason }));

/** A row of the rule's tags as a suggestion. */
const fromRow = ({ tag, facet, count, with_rule }: RuleTagRow, reason: VfolderTagReason) => ({
  tag,
  facet,
  count,
  with_rule,
  reason,
});

/** How much a narrowing tag weighs: its files in the rule, rarer tags counting more. */
const weight = (row: RuleTagRow) => row.with_rule * row.idf;

/** Tags on some of the rule's files but not all: adding one narrows it. Rarer tags weigh more. */
function narrowing(inRule: RuleTagRow[], matches: number): VfolderTagSuggestion[] {
  const narrows = inRule.filter((row) => row.with_rule >= MIN_NARROWING && row.with_rule < matches);
  return narrows
    .toSorted((a, b) => weight(b) - weight(a) || byCodePoint(a.tag, b.tag))
    .map((row) => fromRow(row, 'narrows'));
}

/** With no tags in the rule, the tags most of its files carry. */
function common(inRule: RuleTagRow[]): VfolderTagSuggestion[] {
  return inRule
    .toSorted((a, b) => b.with_rule - a.with_rule || byCodePoint(a.tag, b.tag))
    .map((row) => fromRow(row, 'common'));
}

/** Tags the newest applied plans added, newest plan first and, within one, the most added first. */
function recentTags(db: Db): Tag[] {
  const plans = db.listPlans('applied').slice(0, RECENT_PLANS);
  const added = plans.flatMap((plan) =>
    Object.entries(plan.summary.added)
      .toSorted(([a, x], [b, y]) => y - x || byCodePoint(a, b))
      .map(([tag]) => tag),
  );
  return [...new Set(added)];
}
