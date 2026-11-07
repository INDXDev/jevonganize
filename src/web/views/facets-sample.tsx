import { t } from '../i18n/index.ts';
import { useState } from 'react';
import type { Estimate, Facet, Job } from '../../types.ts';
import { act, useTool } from '../api.ts';
import { Block } from '../components/block.tsx';
import { Pane } from '../components/pane.tsx';
import { Button } from '../components/ui/button.tsx';
import { useReset } from '../lib.ts';
import { activeTab } from '../tabs.ts';
import { parseView } from '../view-query.ts';

/** How many files of the current folder a sample run asks about. */
const SAMPLE_SIZE = 20;

/** A sample's size and price, such as "20 files · about $0.04". */
function sampleCost({ files, cost_usd: costUsd }: Estimate) {
  const fileCount = t('{count} files', { count: files });
  const price =
    costUsd === null ? t('cost unknown') : t('about ${cost}', { cost: costUsd.toFixed(2) });
  return `${fileCount} · ${price}`;
}

/** The job a sample started, and the plan it stored once done. */
function useSampleJob(jobId: string | undefined) {
  const { data: status } = useTool('status', {});
  const job: Job | undefined = status?.jobs.find((entry) => entry.id === jobId);
  const planId = job?.plan_id;
  const { data: plan } = useTool('get_plan', { id: planId ?? '' }, { enabled: !!planId });
  return { job, plan };
}

/** A paid run of the edited facet on a few files, which stores a plan like any other run. */
export function Sample({ draft, save }: { draft: Facet; save: () => Promise<boolean> }) {
  const folder = parseView(activeTab().query).folder;
  const query = { folder, limit: SAMPLE_SIZE };
  const facets = [draft.id];
  const hasId = !!draft.id;
  const { data: estimate } = useTool('estimate', { query, facets }, { enabled: hasId });
  const [jobId, setJobId] = useState<string>();
  const { job, plan } = useSampleJob(jobId);

  useReset(draft.id, () => setJobId(undefined));

  const run = async () => {
    const saved = await save();
    if (!saved) return;
    const started = await act('organize', { query, facets });
    setJobId(started?.id);
  };
  return (
    <Pane
      id="sample"
      title={t('Sample on 20 files')}
      defaultSize="26%"
      minSize={240}
      className="space-y-3 p-3"
    >
      <p className="font-mono text-xs text-muted-foreground">
        {estimate ? sampleCost(estimate) : t('Save an id to estimate.')}
      </p>
      <p className="text-xs text-subtle">
        {' '}
        {t(
          'Saves, then asks the model about 20 files in the current folder. It spends money and stores a plan like any other run. Nothing is written until you apply it.',
        )}{' '}
      </p>
      <Button disabled={!hasId} onClick={() => void run()}>
        {t('Run on sample')}
      </Button>
      {job && <Block job={job} />}
      {plan && <Block plan={plan} />}
    </Pane>
  );
}
