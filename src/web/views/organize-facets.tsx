import { t } from '../i18n/index.ts';
import { ChevronRight } from 'lucide-react';
import { useMemo } from 'react';
import type { FacetInfo } from '../../types.ts';
import { Checkbox } from '../components/ui/field.tsx';

/** A pack's tick: on when every facet is chosen, off when none is, and mixed in between. */
function packTick(chosenCount: number, total: number) {
  if (chosenCount === total) return true;
  return chosenCount ? 'indeterminate' : false;
}

type ChooseFacets = (ids: string[], choose: boolean) => void;

/** A pack that opens on its facets, with a tick for the whole pack and one per facet. */
function PackRow(props: {
  pack: string;
  facets: FacetInfo[];
  chosen: Set<string>;
  onChoose: ChooseFacets;
}) {
  const { pack, facets, chosen, onChoose } = props;
  const ids = facets.map((facet) => facet.id);
  const chosenCount = ids.filter((id) => chosen.has(id)).length;
  return (
    <li>
      <details className="group">
        <summary className="flex h-row cursor-default list-none items-center gap-2 px-2 text-sm">
          <ChevronRight className="size-3 shrink-0 text-subtle group-open:rotate-90" />
          <Checkbox
            aria-label={t('Pack {pack}', { pack })}
            checked={packTick(chosenCount, ids.length)}
            // A click on the tick must not also open or close the pack.
            onClick={(e) => e.stopPropagation()}
            onCheckedChange={(checked) => onChoose(ids, checked === true)}
          />
          <span className="min-w-0 flex-1 truncate">{pack}</span>
          <span className="font-mono text-xs text-subtle">
            {chosenCount}/{ids.length}
          </span>
        </summary>
        <div className="grid grid-cols-2 gap-x-3 px-7 pb-1.5">
          {facets.map((facet) => (
            <label
              key={facet.id}
              title={facet.instructions ?? facet.title}
              className="flex h-dense min-w-0 items-center gap-1.5 text-sm text-muted-foreground"
            >
              <Checkbox
                checked={chosen.has(facet.id)}
                onCheckedChange={(checked) => onChoose([facet.id], checked === true)}
              />
              <span className="truncate">{facet.title}</span>
            </label>
          ))}
        </div>
      </details>
    </li>
  );
}

/** Packs and their facets. The ticks are this run's `--facets`, so nothing here changes config. */
export function FacetPicker(props: {
  facets: FacetInfo[];
  chosen: Set<string>;
  onChange: (chosen: Set<string>) => void;
}) {
  const { facets, chosen, onChange } = props;
  const facetsByPack = useMemo(() => [...Map.groupBy(facets, (facet) => facet.pack)], [facets]);
  const choose: ChooseFacets = (ids, shouldChoose) => {
    const next = new Set(chosen);
    for (const id of ids) {
      if (shouldChoose) next.add(id);
      else next.delete(id);
    }
    onChange(next);
  };
  return (
    <ul className="max-h-72 divide-y overflow-y-auto rounded-md border">
      {facetsByPack.map(([pack, packFacets]) => (
        <PackRow key={pack} pack={pack} facets={packFacets} chosen={chosen} onChoose={choose} />
      ))}
    </ul>
  );
}
