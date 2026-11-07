/**
 * The cleanup report: tags that look like duplicates of each other, tags on a single file, tags on
 * so many files that they say little, and parents carried beside their own children. It reads the
 * index and changes nothing.
 */
import type { CleanupReport, Tag, TagCount } from '../../types.ts';
import type { Db } from '../db.ts';
import { tagFacet } from '../facets.ts';

/** A tag on more than this share of the files says little about any of them. */
const OVER_BROAD_SHARE = 0.5;
/** Below this many files a share proves nothing. */
const OVER_BROAD_MIN_FILES = 10;

/** A tag reduced to its letters and digits, so `tax-return` and `taxreturn` compare equal. */
const lettersAndDigits = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** Pairs of indexes into the tag counts, each held once under the lower index. */
type IndexPairs = Map<number, Set<number>>;

function addPair(pairs: IndexPairs, a: number, b: number): void {
  const lower = Math.min(a, b);
  const partners = pairs.get(lower) ?? new Set<number>();
  partners.add(Math.max(a, b));
  pairs.set(lower, partners);
}

/** A key that is equal for two tags only when they share a facet and `text`. */
const sameFacetKey = (name: Tag, text: string) => JSON.stringify([tagFacet(name), text]);

/** The indexes of `counts`, grouped by a key of each tag. */
function indexesByKey(counts: TagCount[], keyOf: (name: Tag) => string): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  counts.forEach((row, index) => {
    const key = keyOf(row.tag);
    groups.set(key, [...(groups.get(key) ?? []), index]);
  });
  return groups;
}

/** Pairs tags of one facet that differ only in punctuation and case. */
function pairSpellings(counts: TagCount[], pairs: IndexPairs): void {
  const groups = indexesByKey(counts, (name) => sameFacetKey(name, lettersAndDigits(name)));
  for (const group of groups.values()) {
    group.forEach((index, position) => {
      for (const earlier of group.slice(0, position)) addPair(pairs, earlier, index);
    });
  }
}

/** Every part of a tag before one of its hyphens: `a-b-c` gives `a` and `a-b`. */
function beforeHyphens(name: Tag): string[] {
  const prefixes: string[] = [];
  for (let at = name.indexOf('-'); at >= 0; at = name.indexOf('-', at + 1)) {
    prefixes.push(name.slice(0, at));
  }
  return prefixes;
}

/** Pairs a tag with each tag of its facet that it extends at a hyphen, as `tax-2024` extends `tax`. */
function pairExtensions(counts: TagCount[], pairs: IndexPairs): void {
  const byTag = indexesByKey(counts, (name) => sameFacetKey(name, name));
  counts.forEach((row, index) => {
    for (const prefix of beforeHyphens(row.tag)) {
      const extended = byTag.get(sameFacetKey(row.tag, prefix)) ?? [];
      for (const other of extended) addPair(pairs, other, index);
    }
  });
}

const ascending = (left: number, right: number) => left - right;

/** Same facet, and labels equal but for punctuation, or one extending the other. */
function nearDuplicates(counts: TagCount[]): CleanupReport['near_duplicates'] {
  const pairs: IndexPairs = new Map();
  pairSpellings(counts, pairs);
  pairExtensions(counts, pairs);
  return [...pairs.keys()].toSorted(ascending).flatMap((lower) =>
    [...pairs.get(lower)!].toSorted(ascending).map((higher) => {
      const first = counts[lower]!;
      const second = counts[higher]!;
      return { tags: [first.tag, second.tag], files: first.count + second.count };
    }),
  );
}

/** Tags on so large a share of the files that they tell almost none of them apart. */
function overBroadTags(counts: TagCount[], files: number): TagCount[] {
  if (files < OVER_BROAD_MIN_FILES) return [];
  return counts.filter(({ count }) => count / files > OVER_BROAD_SHARE);
}

/** What `cleanup_report` returns. */
export function cleanupReport(db: Db): CleanupReport {
  const counts = db.tagCounts();
  const { files } = db.stats();
  return {
    near_duplicates: nearDuplicates(counts),
    single_use: counts.filter(({ count }) => count === 1),
    over_broad: overBroadTags(counts, files),
    redundant_parents: db.redundantParents(),
  };
}
