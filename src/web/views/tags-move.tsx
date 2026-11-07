/** Moving a tag in the hierarchy: the parent picker, and the plan `move_tag` makes. */
import { t } from '../i18n/index.ts';
import { useState } from 'react';
import type { TagNode } from '../../types.ts';
import { act } from '../api.ts';
import { Button } from '../components/ui/button.tsx';
import { Dialog } from '../components/ui/dialog.tsx';
import { Select } from '../components/ui/field.tsx';
import { dropParent } from './tags-drag.ts';

/** Plans moving `from` under `parent`, or to the top for null, and hands the plan's id on. */
export async function planMove(from: string, parent: string | null, onPlan: (id: string) => void) {
  const plan = await act('move_tag', { from, parent });
  if (plan) onPlan(plan.id);
}

/** Every node of the tree, depth first. */
function allNodes(nodes: TagNode[]): TagNode[] {
  return nodes.flatMap((node) => [node, ...allNodes(node.children)]);
}

/** The tags `node` can move under: in its facet, not itself or below it, and not its parent now. */
function parentChoices(tree: TagNode[], node: TagNode): string[] {
  return allNodes(tree)
    .filter((other) => other.depth > 0 && dropParent(node, other, false) !== undefined)
    .map((other) => other.path);
}

/** The dialog that picks a new parent for a tag. */
export function MoveDialog(props: {
  node: TagNode;
  tree: TagNode[];
  onClose: () => void;
  onPlan: (id: string) => void;
}) {
  const { node, tree, onClose, onPlan } = props;
  const choices = parentChoices(tree, node);
  const [parent, setParent] = useState(choices[0]);
  const submit = () => {
    onClose();
    if (parent) void planMove(node.path, parent, onPlan);
  };
  return (
    <Dialog open onClose={onClose} title={t('Move {tag}', { tag: node.path })}>
      <div className="flex items-center gap-2 p-3">
        {choices.length ? (
          <Select
            label={t('New parent')}
            className="min-w-0 flex-1 font-mono text-xs"
            value={parent ?? ''}
            options={choices.map((value) => ({ value }))}
            onChange={setParent}
          />
        ) : (
          <p className="flex-1 text-sm text-subtle">
            {t('No other tag in this facet to move under.')}
          </p>
        )}
        <Button variant="primary" disabled={!parent} onClick={submit}>
          {t('Plan move')}
        </Button>
      </div>
    </Dialog>
  );
}
