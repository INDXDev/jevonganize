import { t } from '../i18n/index.ts';
import { useMemo } from 'react';
import type { Tag } from '../../types.ts';
import { act, useTool } from '../api.ts';

/** The facet proper names live under, so each is a tag `entity:<kind>/<name>`. */
export const ENTITY_FACET = 'entity';

/** The kinds of proper name, in the order the kind select lists them. */
export const KINDS = ['person', 'organization', 'place', 'product', 'project', 'event'] as const;

/** A kind's label, or the kind itself for one this list does not know. */
export const kindLabel = (kind: string) =>
  ({
    person: t('Person'),
    organization: t('Organization'),
    place: t('Place'),
    product: t('Product'),
    project: t('Project'),
    event: t('Event'),
  })[kind] ?? kind;

/** A proper name in the list: its tag, its kind, the files that have it, and whether it is registered. */
export type Name = { tag: Tag; kind: string; count: number; registered: boolean };

/** The vocabulary value of a name's tag: `entity:person/Ada` gives `person/Ada`. */
const vocabularyValue = (tag: Tag) => tag.slice(ENTITY_FACET.length + 1);

/** Registers a name, so Organize looks for it, or retires it, so the model stops offering it. */
export const setNameState = (tag: Tag, state: 'active' | 'retired') =>
  act('set_vocabulary', { facet: ENTITY_FACET, value: vocabularyValue(tag), state });

/** Takes a name off its files and keeps the model from offering it again. Undo restores the tags. */
export async function dropName(tag: Tag, folder?: string) {
  const title = t('Remove {tag}', { tag });
  const plan = await act('propose_changes', {
    query: { tags: [tag], folder },
    remove: [tag],
    title,
  });
  if (plan) await act('apply_plan', { id: plan.id });
  await setNameState(tag, 'retired');
}

/** Most used first, then by tag, so names with as many files stay in a stable order. */
const byUseThenTag = (a: Name, b: Name) => b.count - a.count || a.tag.localeCompare(b.tag);

/** Names on files and names a person registered, as one list. Retired ones are gone from both. */
export function useNames(folder?: string): Name[] {
  const { data: tags = [] } = useTool('list_tags', { folder, facet: ENTITY_FACET });
  const { data: entries = [] } = useTool('list_vocabulary', { facet: ENTITY_FACET });
  return useMemo(() => {
    const activeEntries = entries.filter((entry) => entry.state === 'active');
    const registered = new Set(activeEntries.map((entry) => `${ENTITY_FACET}:${entry.value}`));
    const fileCounts = new Map(tags.map(({ tag, count }) => [tag, count]));
    const allTags = new Set([...registered, ...fileCounts.keys()]);
    const names = [...allTags].map((tag) => ({
      tag,
      kind: vocabularyValue(tag).split('/')[0]!,
      count: fileCounts.get(tag) ?? 0,
      registered: registered.has(tag),
    }));
    return names.toSorted(byUseThenTag);
  }, [tags, entries]);
}
