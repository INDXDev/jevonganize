import { t } from '../i18n/index.ts';
import { useState } from 'react';
import { act } from '../api.ts';
import { Button } from '../components/ui/button.tsx';
import { Dialog } from '../components/ui/dialog.tsx';
import { Checkbox, Input } from '../components/ui/field.tsx';

/**
 * The dialog for a new tag name. `onPlan` gets the plan it makes. With `hasChildren`, a tick renames
 * the tags under it too, as `rename_tag` with `children`.
 */
export function Rename(props: {
  tag: string;
  hasChildren?: boolean;
  onClose: () => void;
  onPlan: (id: string) => void;
}) {
  const { tag, hasChildren, onClose, onPlan } = props;
  const [newName, setNewName] = useState(tag);
  const [children, setChildren] = useState(!!hasChildren);
  const trimmed = newName.trim();
  const canSubmit = !!trimmed && trimmed !== tag;
  const submit = async () => {
    onClose();
    const plan = await act('rename_tag', {
      from: tag,
      to: trimmed,
      children: children || undefined,
    });
    if (plan) onPlan(plan.id);
  };
  return (
    <Dialog open onClose={onClose} title={t('Rename {tag}', { tag })}>
      <form
        className="space-y-2 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="flex gap-2">
          <Input
            aria-label={t('New tag')}
            className="font-mono"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <Button type="submit" variant="primary" disabled={!canSubmit}>
            {t('Plan rename')}
          </Button>
        </div>
        {hasChildren && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox checked={children} onCheckedChange={(next) => setChildren(next === true)} />
            {t('Include the tags under it')}
          </label>
        )}
      </form>
    </Dialog>
  );
}
