import { t } from '../i18n/index.ts';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Facet, FacetInfo } from '../../types.ts';
import { act, useTool } from '../api.ts';
import { Divider, Pane, Panes } from '../components/pane.tsx';
import { Button } from '../components/ui/button.tsx';
import { keyLabel, useReset } from '../lib.ts';
import { notify, setView, useActions, useView } from '../tabs.ts';
import { Form } from './facets-form.tsx';
import { Packs } from './facets-packs.tsx';
import { Sample } from './facets-sample.tsx';

/** What the form starts from for a new facet. */
const NEW_FACET: Facet = {
  id: '',
  pack: 'custom',
  title: '',
  kind: 'choice',
  applies_to: [],
  weight: 1,
  values: {},
};

/** The facet itself, without the list's `enabled` and `custom` flags, which saving does not take. */
const facetOnly = ({ enabled: _enabled, custom: _custom, ...facet }: FacetInfo): Facet => facet;

/** Saves `draft` unless it has no id or nothing changed. True when it is saved or already was. */
async function saveDraft(draft: Facet, isDirty: boolean): Promise<boolean> {
  if (!draft.id) {
    notify(t('A facet needs an id'), true);
    return false;
  }
  if (!isDirty) return true;
  const saved = await act('save_facet', draft);
  if (!saved) return false;
  notify(t('Saved {id}', { id: saved.id }));
  setView({ facet: saved.id });
  return true;
}

/** The edited copy of a facet, which resets when another facet opens, and how it is saved. */
function useFacetDraft(current?: FacetInfo) {
  const base = useMemo(() => (current ? facetOnly(current) : NEW_FACET), [current]);
  const [draft, setDraft] = useState<Facet>(base);
  useReset(base, () => setDraft(base));

  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  const save = () => saveDraft(draft, dirty);
  useActions({ save: () => void save() });

  const set = (patch: Partial<Facet>) => setDraft((before) => ({ ...before, ...patch }));
  return { draft, set, dirty, save, discard: () => setDraft(base) };
}

/** Where the open facet comes from, and what saving or deleting it does. */
function originNote(current?: FacetInfo) {
  if (current?.custom) return t('Your copy. Removing it brings the built-in back.');
  return current ? t('Built-in. Saving creates your copy.') : t('A new facet.');
}

function SaveBar(props: {
  current?: FacetInfo;
  dirty: boolean;
  onDiscard: () => void;
  onSave: () => void;
}) {
  const { current, dirty, onDiscard, onSave } = props;
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-t bg-surface-1 px-3 text-xs text-subtle">
      <span className="mr-auto">
        {originNote(current)}
        {dirty && t(' Changing what the model sees asks that facet again.')}
      </span>
      {current?.custom && (
        <Button variant="danger" onClick={() => void act('delete_facet', { id: current.id })}>
          {t('Delete copy')}
        </Button>
      )}
      <Button variant="ghost" disabled={!dirty} onClick={onDiscard}>
        {t('Discard')}
      </Button>
      <Button variant="primary" disabled={!dirty} onClick={onSave}>
        {' '}
        {t('Save')} <span className="font-mono text-2xs opacity-70">{keyLabel('mod+s')}</span>
      </Button>
    </div>
  );
}

/** The facet the URL names. With none named, the first; with `new`, none, so the form starts blank. */
function openFacet(facets: FacetInfo[], facetId: string | null | undefined) {
  const named = facets.find((facet) => facet.id === facetId);
  if (named) return named;
  return facetId === 'new' ? undefined : facets[0];
}

/** Packs, the facet form for the chosen kind, and a paid sample run. */
export function Facets() {
  const view = useView();
  const { data: facets = [], isLoading, error } = useTool('list_facets', {});
  const current = openFacet(facets, view.facet);
  const { draft, set, dirty, save, discard } = useFacetDraft(current);
  const newButton = (
    <Button variant="ghost" className="h-6" onClick={() => setView({ facet: 'new' })}>
      <Plus /> {t('New')}
    </Button>
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Panes id="facets" panes={['packs', 'form', 'sample']}>
        <Packs facets={facets} current={current?.id} actions={newButton} />
        <Divider />
        <Pane
          id="form"
          minSize={360}
          loading={isLoading}
          error={error}
          title={draft.title || draft.id || t('New facet')}
          actions={<span className="font-mono text-xs text-subtle">{draft.pack}</span>}
        >
          <Form draft={draft} set={set} />
        </Pane>
        <Divider />
        <Sample draft={draft} save={save} />
      </Panes>
      <SaveBar current={current} dirty={dirty} onDiscard={discard} onSave={() => void save()} />
    </div>
  );
}
