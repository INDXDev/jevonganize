import { useState } from 'react';
import { useTool } from '../api.ts';
import { Block } from './block.tsx';
import { Dialog } from './ui/dialog.tsx';

/** A stored plan in a dialog, as a block with the usual apply and discard. Closed for `null`. */
function PlanDialog({ planId, onClose }: { planId: string | null; onClose: () => void }) {
  const { data: plan } = useTool('get_plan', { id: planId ?? '' }, { enabled: !!planId });
  return (
    <Dialog open={!!planId && !!plan} onClose={onClose} title={plan?.title ?? ''}>
      <div className="overflow-y-auto p-3">{plan && <Block plan={plan} />}</div>
    </Dialog>
  );
}

/**
 * The plan a drop just stored. `show` opens it, and `dialog` renders it, so a view that turns drops
 * into plans needs no dialog state of its own.
 */
export function usePlanDialog() {
  const [planId, setPlanId] = useState<string | null>(null);
  const dialog = <PlanDialog planId={planId} onClose={() => setPlanId(null)} />;
  return { show: setPlanId, dialog };
}
