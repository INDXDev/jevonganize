/**
 * The vocabulary follows a renamed tag. In an open facet, moving `topic:tax` under `topic:finance`
 * retires `tax` and `tax/vat` and turns `finance/tax` and `finance/tax/vat` active, so organize
 * answers with the new paths and never offers the old ones again.
 */
import type { Facet, Plan, TagRename } from '../types.ts';
import type { Db } from './db.ts';
import type { VocabularyState } from './db/vocabulary.ts';
import type { RenameFollower } from './rename-follower.ts';
import { facetsById, isWithin, placeOf } from './tag-place.ts';

/** A vocabulary row as it was before a rename, with null for one that did not exist. */
interface VocabularyRowBefore {
  facetId: string;
  label: string;
  state: VocabularyState | null;
}

/** An open facet's rename, as labels: `fromLabel` and every label under it become `toLabel`. */
interface OpenFacetRename {
  facet: Facet;
  fromLabel: string;
  toLabel: string;
}

/** The labels of a rename within one open facet, or null for any other rename. */
function toOpenFacetRename(rename: TagRename, facets: Map<string, Facet>): OpenFacetRename | null {
  const from = placeOf(rename.from, facets);
  const to = placeOf(rename.to, facets);
  const { facet } = from;
  const staysInOpenFacet = facet?.open === true && to.facet?.id === facet.id;
  if (!staysInOpenFacet || from.label === null || to.label === null) return null;
  return { facet, fromLabel: from.label, toLabel: to.label };
}

/** The labels of a facet that the plan took off files, such as `tax` for `topic:tax`. */
function labelsTakenOff(plan: Plan, facet: Facet): string[] {
  const prefix = `${facet.id}:`;
  const removed = plan.ops.flatMap((op) => op.remove);
  return removed.filter((tag) => tag.startsWith(prefix)).map((tag) => tag.slice(prefix.length));
}

/** The labels under `fromLabel` the facet knows: its vocabulary, its preset values, its tags. */
function labelsToRetire(db: Db, plan: Plan, { facet, fromLabel }: OpenFacetRename): Set<string> {
  const vocabulary = db.listVocabulary(facet.id).filter((row) => row.state !== 'retired');
  const presets = Object.keys(facet.values ?? {});
  const labels = [
    ...vocabulary.map((row) => row.value),
    ...presets,
    ...labelsTakenOff(plan, facet),
  ];
  return new Set(labels.filter((label) => isWithin(label, fromLabel)));
}

/** A label under `fromLabel` with its prefix replaced: `tax/vat` becomes `finance/tax/vat`. */
const movedLabel = (oldLabel: string, { fromLabel, toLabel }: OpenFacetRename) =>
  toLabel + oldLabel.slice(fromLabel.length);

/** One vocabulary row to set. */
interface VocabularyRowChange {
  facetId: string;
  label: string;
  state: VocabularyState;
}

/** The rows a plan's renames set: each old label retired, and its new label turned active. */
function vocabularyChangesFor(db: Db, plan: Plan, facets: Facet[]): VocabularyRowChange[] {
  const facetsByIdMap = facetsById(facets);
  const changes: VocabularyRowChange[] = [];
  for (const rename of plan.renames ?? []) {
    const facetRename = toOpenFacetRename(rename, facetsByIdMap);
    if (!facetRename) continue;
    const facetId = facetRename.facet.id;
    for (const oldLabel of labelsToRetire(db, plan, facetRename)) {
      const newLabel = movedLabel(oldLabel, facetRename);
      changes.push({ facetId, label: oldLabel, state: 'retired' });
      changes.push({ facetId, label: newLabel, state: 'active' });
    }
  }
  return changes;
}

/** A key naming one vocabulary row. */
const keyOf = (facetId: string, label: string) => JSON.stringify([facetId, label]);

/** The rows the changes touch, as they are now: null for a row that does not exist yet. */
function rowsBefore(db: Db, changes: VocabularyRowChange[]): VocabularyRowBefore[] {
  const rows = db.listVocabulary();
  const stateNow = new Map(rows.map((row) => [keyOf(row.facet, row.value), row.state]));
  const touched = new Map<string, VocabularyRowBefore>();
  for (const { facetId, label } of changes) {
    const key = keyOf(facetId, label);
    touched.set(key, { facetId, label, state: stateNow.get(key) ?? null });
  }
  return [...touched.values()];
}

/** Retires each old path of an open facet and turns its new path active. */
export const vocabularyFollower: RenameFollower<VocabularyRowBefore[]> = {
  name: 'vocabulary',
  follow(db, plan, facets) {
    const changes = vocabularyChangesFor(db, plan, facets);
    if (changes.length === 0) return undefined;
    const before = rowsBefore(db, changes);
    for (const { facetId, label, state } of changes) db.setVocabulary(facetId, label, state);
    return before;
  },
  restore(db, saved) {
    for (const { facetId, label, state } of saved) {
      if (state === null) db.deleteVocabulary(facetId, label);
      else db.setVocabulary(facetId, label, state);
    }
  },
};
