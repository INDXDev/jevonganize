/**
 * Folders worth saving, from the index's tag statistics alone: large tags, tags that go together,
 * and the parents of hierarchical values. Calls no model. See docs/contracts.md#suggesting-folders.
 */
import type { FolderRule, Tag, TagCount } from '../types.ts';
import type { VfolderSuggestion } from '../tool-map.ts';
import type { Db } from './db.ts';
import { byCodePoint, retiredTags } from './vfolder-suggest.ts';
import { loadFolders } from './vfolders.ts';

/** How many folders `suggest_vfolders` offers unless asked, and at most. */
export const FOLDER_LIMITS = { fallback: 8, max: 30 } as const;
/** A suggested folder holds at least this many files, or tags for a namespace. */
const MIN_FILES = 2;
/** Pairs come from this many of the most used tags, which bounds the self-join. */
const PAIR_TAGS = 50;
/** Namespaces whose large tags come first: the ones people file by. */
const PREFERRED = new Set(['topic', 'party', 'project', 'entity']);

/** A suggestion before its count, which only the chosen few need. */
type Candidate = Omit<VfolderSuggestion, 'count'>;

/** The part of a tag after its namespace, or the whole tag when it has none. */
const valueOf = (tag: Tag): string => {
  const colon = tag.indexOf(':');
  return colon > 0 && colon < tag.length - 1 ? tag.slice(colon + 1) : tag;
};

/** The namespace of a tag, or the empty string. */
const namespaceOf = (tag: Tag): string => {
  const colon = tag.indexOf(':');
  return colon > 0 ? tag.slice(0, colon) : '';
};

/** A tag's value as a person reads it: `topic:finance/tax` is `finance / tax`. */
export const readableName = (tag: Tag): string => valueOf(tag).split('/').join(' / ');

/** A rule on these tags that a file needs all of. */
const ruleOf = (tags: Tag[]): FolderRule => ({ tags, tag_match: 'all', exclude_tags: [] });

/** One text per meaning: with a single tag, `any` and `all` are the same rule. */
export function ruleKey(rule: FolderRule): string {
  const tags = rule.tags.toSorted(byCodePoint);
  const match = tags.length > 1 ? rule.tag_match : 'one';
  return JSON.stringify([
    tags,
    match,
    rule.exclude_tags.toSorted(byCodePoint),
    rule.folder ?? null,
  ]);
}

/** What `suggest_vfolders` returns. */
export function suggestFolders(
  db: Db,
  limit: number = FOLDER_LIMITS.fallback,
): VfolderSuggestion[] {
  const retired = retiredTags(db);
  const inUse = db.tagCounts().filter(({ tag }) => !retired.has(tag));
  const kinds = [largeTags(inUse), pairs(db, retired), namespaces(inUse, retired)];
  const taken = new Set([...loadFolders(db).values()].map((folder) => ruleKey(folder.rule)));
  const chosen: Candidate[] = [];
  for (const candidate of interleave(kinds)) {
    if (chosen.length >= Math.min(limit, FOLDER_LIMITS.max)) break;
    const key = ruleKey(candidate.rule);
    if (taken.has(key)) continue;
    taken.add(key);
    chosen.push(candidate);
  }
  return chosen.map((candidate) => ({ ...candidate, count: db.countFiles(candidate.rule) }));
}

/** One of each list in turn, so every kind shows near the top. */
function* interleave<T>(lists: T[][]): Generator<T> {
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let index = 0; index < longest; index++) {
    for (const list of lists) if (index < list.length) yield list[index]!;
  }
}

/** 0 for a tag in a namespace people file by, else 1. */
const rank = ({ tag }: TagCount) => (PREFERRED.has(namespaceOf(tag)) ? 0 : 1);

/** Tags on many files, the namespaces people file by first. */
function largeTags(inUse: TagCount[]): Candidate[] {
  return inUse
    .filter(({ count }) => count >= MIN_FILES)
    .toSorted((a, b) => rank(a) - rank(b) || b.count - a.count || byCodePoint(a.tag, b.tag))
    .map(({ tag }) => ({ name: readableName(tag), rule: ruleOf([tag]), reason: 'large-tag' }));
}

/** True when one tag is the other or under it, which no pair should be. */
const related = (a: Tag, b: Tag) => a === b || b.startsWith(`${a}/`) || a.startsWith(`${b}/`);

/** Tags that more files carry together than chance would give: lift above 1. */
function pairs(db: Db, retired: Set<Tag>): Candidate[] {
  const files = db.countFiles({});
  return db
    .tagPairs(PAIR_TAGS, MIN_FILES)
    .filter(({ first, second }) => !retired.has(first) && !retired.has(second))
    .filter(({ first, second }) => !related(first, second))
    .filter((row) => row.together * files > row.first_count * row.second_count)
    .map(({ first, second }) => ({
      name: `${readableName(first)} × ${readableName(second)}`,
      rule: ruleOf([first, second]),
      reason: 'pair',
    }));
}

/** Every proper ancestor of a hierarchical tag: `topic:a/b/c` has `topic:a` and `topic:a/b`. */
function ancestorsOf(tag: Tag): Tag[] {
  const namespace = namespaceOf(tag);
  const prefix = namespace && tag !== valueOf(tag) ? `${namespace}:` : '';
  const steps = valueOf(tag).split('/');
  return steps.slice(1).map((_, index) => prefix + steps.slice(0, index + 1).join('/'));
}

/** The parents of hierarchical values that hold at least two tags, the most used first. */
function namespaces(inUse: TagCount[], retired: Set<Tag>): Candidate[] {
  const under = new Map<Tag, { tags: number; files: number }>();
  const credit = (parent: Tag, files: number) => {
    const entry = under.get(parent) ?? { tags: 0, files: 0 };
    under.set(parent, { tags: entry.tags + 1, files: entry.files + files });
  };
  for (const { tag, count } of inUse) {
    for (const parent of ancestorsOf(tag)) credit(parent, count);
  }
  // A parent that is itself a tag holds one more: its own.
  for (const { tag, count } of inUse) if (under.has(tag)) credit(tag, count);
  return [...under]
    .filter(([parent, { tags }]) => tags >= MIN_FILES && !retired.has(parent))
    .toSorted(([a, x], [b, y]) => y.files - x.files || byCodePoint(a, b))
    .map(([parent]) => ({
      name: readableName(parent),
      rule: ruleOf([parent]),
      reason: 'namespace',
    }));
}
