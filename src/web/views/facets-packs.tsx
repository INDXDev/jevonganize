import { t } from '../i18n/index.ts';
import { useMemo, useState, type ReactNode } from 'react';
import type { FacetInfo } from '../../types.ts';
import { act, useTool } from '../api.ts';
import { Pane } from '../components/pane.tsx';
import { Checkbox, Input } from '../components/ui/field.tsx';
import { cn } from '../lib.ts';
import { setView } from '../tabs.ts';

/** Searches start at this many letters, as one letter matches most of the catalog. */
const MIN_SEARCH_LENGTH = 2;

const addTopic = (value: string) =>
  void act('set_vocabulary', { facet: 'topic', value, state: 'active' });

/** Finds catalog topics by text. A click makes one a value of `topic`. */
function CatalogSearch() {
  const [text, setText] = useState('');
  const isSearching = text.length >= MIN_SEARCH_LENGTH;
  const { data: values = [] } = useTool(
    'search_catalog',
    { text: text.toLowerCase(), limit: 20 },
    { enabled: isSearching },
  );
  return (
    <section className="flex flex-col gap-1 px-1.5 pb-2">
      <Input
        aria-label={t('Search topic catalog')}
        placeholder={t('Search topic catalog')}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      {isSearching &&
        values.map((value) => (
          <button
            key={value}
            type="button"
            aria-label={t('Add topic {value}', { value })}
            onClick={() => addTopic(value)}
            className="truncate text-left font-mono text-xs text-muted-foreground hover:text-foreground"
          >
            {value}
          </button>
        ))}
    </section>
  );
}

/** Turns a pack, or one facet, on or off. A pack's id switches every facet in it. */
const setEnabled = (id: string, checked: unknown) =>
  void act('set_enabled', { ids: [id], enabled: checked === true });

/** One facet: its switch, the button that opens it, and a mark when it is your copy. */
function FacetRow({ facet, isOpen }: { facet: FacetInfo; isOpen: boolean }) {
  return (
    <div
      className={cn(
        'flex h-dense items-center gap-2 rounded-sm pr-1.5 pl-6 hover:bg-surface-2',
        isOpen && 'bg-soft',
      )}
    >
      <Checkbox
        aria-label={t('Facet {id}', { id: facet.id })}
        checked={facet.enabled}
        onCheckedChange={(checked) => setEnabled(facet.id, checked)}
      />
      <button
        type="button"
        aria-current={isOpen}
        onClick={() => setView({ facet: facet.id })}
        className="min-w-0 flex-1 truncate text-left font-mono text-xs text-muted-foreground hover:text-foreground"
      >
        {facet.id}
      </button>
      {facet.custom && <span className="text-2xs text-subtle">{t('custom')}</span>}
    </div>
  );
}

/** A pack: its switch, on while any of its facets is, then each facet. */
function PackSection(props: { pack: string; facets: FacetInfo[]; openId?: string }) {
  const { pack, facets, openId } = props;
  const anyEnabled = facets.some((facet) => facet.enabled);
  return (
    <section className="pb-2">
      <label className="flex h-row items-center gap-2 px-1.5 text-sm font-medium">
        <Checkbox
          aria-label={t('Pack {pack}', { pack })}
          checked={anyEnabled}
          onCheckedChange={(checked) => setEnabled(pack, checked)}
        />
        <span className="capitalize">{pack}</span>
        <span className="ml-auto font-mono text-xs text-subtle">{facets.length}</span>
      </label>
      {facets.map((facet) => (
        <FacetRow key={facet.id} facet={facet} isOpen={facet.id === openId} />
      ))}
    </section>
  );
}

/** The packs pane: catalog search, then every pack with its facets. */
export function Packs(props: { facets: FacetInfo[]; current?: string; actions: ReactNode }) {
  const { facets, current, actions } = props;
  const facetsByPack = useMemo(() => [...Map.groupBy(facets, (facet) => facet.pack)], [facets]);
  return (
    <Pane
      id="packs"
      title={t('Facets')}
      actions={actions}
      defaultSize="22%"
      minSize={200}
      className="p-1.5"
    >
      <CatalogSearch />
      {facetsByPack.map(([pack, packFacets]) => (
        <PackSection key={pack} pack={pack} facets={packFacets} openId={current} />
      ))}
    </Pane>
  );
}
