import { t } from '../i18n/index.ts';
import { Check, SkipForward, X } from 'lucide-react';
import type { FileRow, ReviewItem } from '../../types.ts';
import { Pane } from '../components/pane.tsx';
import { Preview } from '../components/preview/index.tsx';
import { TagChip } from '../components/tag-chip.tsx';
import { Button } from '../components/ui/button.tsx';

/** Sends a decision on review items by their ids. */
export type Decide = (ids: number[], accept: boolean) => void;

/** Why an item was suggested: the model's reason, or that the tag was there before. */
const itemReason = (item: ReviewItem) =>
  item.kind === 'restore' ? t('This tag was on the file before it was saved.') : item.reason;

/** The open item: its preview, why it was suggested, and accept, reject and skip. */
function ItemDetail(props: {
  item: ReviewItem;
  file: FileRow;
  onDecide: Decide;
  onSkip: () => void;
}) {
  const { item, file, onDecide, onSkip } = props;
  return (
    <>
      <div className="h-64 overflow-hidden border-b bg-surface-2">
        <Preview file={file} />
      </div>
      <div className="space-y-3 p-3">
        <div>
          <h3 className="label mb-1">{t('Why')}</h3>
          <p className="text-sm text-muted-foreground">{itemReason(item)}</p>
        </div>
        <TagChip tag={item.tag} confidence={item.confidence} />
        <div className="flex gap-1.5">
          <Button variant="primary" onClick={() => onDecide([item.id], true)}>
            <Check /> {t('Accept')} <span className="font-mono text-2xs opacity-70">A</span>
          </Button>
          <Button onClick={() => onDecide([item.id], false)}>
            <X /> {t('Reject')} <span className="kbd">R</span>
          </Button>
          <Button variant="ghost" onClick={onSkip}>
            <SkipForward /> {t('Skip')} <span className="kbd">S</span>
          </Button>
        </div>
      </div>
    </>
  );
}

/** One suggestion: the preview, why it was made, and the decision. */
export function ItemPane(props: {
  item?: ReviewItem;
  file?: FileRow;
  onDecide: Decide;
  onSkip: () => void;
}) {
  const { item, file, onDecide, onSkip } = props;
  return (
    <Pane id="item" defaultSize="28%" minSize={260} title={file?.name ?? t('Item')}>
      {item && file && <ItemDetail item={item} file={file} onDecide={onDecide} onSkip={onSkip} />}
    </Pane>
  );
}
