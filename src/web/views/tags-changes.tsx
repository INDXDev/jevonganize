import { t } from '../i18n/index.ts';
import type { Plan, VocabularyEntry } from '../../types.ts';
import { act } from '../api.ts';
import { Block } from '../components/block.tsx';
import { TagChip } from '../components/tag-chip.tsx';
import { Button } from '../components/ui/button.tsx';

const stateLabel = (state: VocabularyEntry['state']) =>
  ({
    active: t('Active'),
    retired: t('Retired'),
    proposed: t('Proposed value'),
  })[state];

/** Retires an active value, or activates a retired or proposed one. */
export const toggleState = ({ facet, value, state }: VocabularyEntry) =>
  void act('set_vocabulary', { facet, value, state: state === 'active' ? 'retired' : 'active' });

/** The open vocabularies' values, each with its state and the button that flips it. */
function Vocabulary({ entries }: { entries: VocabularyEntry[] }) {
  return (
    <section>
      <h3 className="label mb-1">{t('Open vocabulary')}</h3>
      <ul className="divide-y rounded-md border">
        {entries.map((entry) => {
          const tag = `${entry.facet}:${entry.value}`;
          return (
            <li key={tag} className="flex h-row items-center gap-2 px-2">
              <span className="min-w-0 flex-1">
                <TagChip tag={tag} />
              </span>
              <span className="font-mono text-xs text-subtle">{stateLabel(entry.state)}</span>
              <Button variant="ghost" className="h-6" onClick={() => toggleState(entry)}>
                {entry.state === 'active' ? t('Retire') : t('Activate')}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The side pane: the last rename or removal plan, then the open vocabularies. */
export function TagChanges({ plan, vocabulary }: { plan?: Plan; vocabulary: VocabularyEntry[] }) {
  return (
    <div className="space-y-3 p-3">
      {plan ? (
        <Block plan={plan} />
      ) : (
        <p className="text-sm text-subtle">
          {t('Renames and removals become a plan here. Nothing changes until you apply it.')}
        </p>
      )}
      {vocabulary.length > 0 && <Vocabulary entries={vocabulary} />}
    </div>
  );
}
