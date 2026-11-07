import { t } from '../i18n/index.ts';
import { RefreshCw, Sparkles } from 'lucide-react';
import { useState } from 'react';
import type { Job, RefreshCandidates } from '../../types.ts';
import { call, queryClient, useTool } from '../api.ts';
import { Block } from '../components/block.tsx';
import { Button } from '../components/ui/button.tsx';
import { Dialog } from '../components/ui/dialog.tsx';
import { Input } from '../components/ui/field.tsx';
import { formatCount, needsKey } from '../lib.ts';
import { setView } from '../tabs.ts';
import { Findings } from './tag-refresh-findings.tsx';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** The button that opens a refresh, in a tag's detail pane and in Files filtered to one tag. */
export function RefreshButton(props: { tag: string; onClick: () => void; label?: boolean }) {
  const { tag, onClick, label } = props;
  return (
    <Button
      variant="ghost"
      icon={!label}
      className={label ? 'h-6' : 'size-6'}
      aria-label={t('Refresh {tag}', { tag })}
      title={t('Find files that should have this tag, and check them')}
      onClick={onClick}
    >
      <RefreshCw /> {label && t('Refresh')}
    </Button>
  );
}

/** Once the run is done: a note that nothing needs review, or the way into Review. */
function AfterRun({ job, tag, onClose }: { job: Job; tag: string; onClose: () => void }) {
  if (job.status !== 'done') return null;
  const reviews = job.reviews ?? 0;
  if (reviews === 0) {
    return <p className="text-sm text-muted-foreground">{t('No file needs review.')}</p>;
  }
  const openReview = () => {
    onClose();
    setView({ screen: 'tags', tag: [tag], section: 'review' });
  };
  return (
    <Button variant="primary" onClick={openReview}>
      {t('{count} files to review', { count: formatCount(reviews) })}
    </Button>
  );
}

/** The run of a refresh, once started: its progress, then the way into Review. */
function RunProgress(props: { startedJob: Job; tag: string; onClose: () => void }) {
  const { startedJob, tag, onClose } = props;
  const { data: status } = useTool('status', {});
  const job = status?.jobs.find((entry) => entry.id === startedJob.id) ?? startedJob;
  return (
    <div className="space-y-2">
      <Block job={job} />
      <AfterRun job={job} tag={tag} onClose={onClose} />
    </div>
  );
}

function MissingKeyNotice({ provider, onClose }: { provider: string; onClose: () => void }) {
  const openKeySettings = () => {
    onClose();
    setView({ screen: 'settings', section: 'keys' });
  };
  return (
    <p className="text-sm text-warn">
      {t('No API key for {provider}.', { provider })}{' '}
      <button type="button" className="underline" onClick={openKeySettings}>
        {t('Add one in Settings')}
      </button>
    </p>
  );
}

function ErrorText({ text }: { text: string }) {
  return (
    <p role="alert" className="text-sm text-destructive">
      {text}
    </p>
  );
}

/** A typed limit, kept between 1 and `MAX_LIMIT`, with anything unreadable taken as 1. */
const clampLimit = (typed: string) => Math.min(Math.max(Number(typed) || 1, 1), MAX_LIMIT);

/** The limit on how many candidates to look for, and the button that starts checking them. */
function CheckBar(props: {
  limit: number;
  onLimit: (limit: number) => void;
  count: number;
  disabled: boolean;
  onCheck: () => void;
}) {
  const { limit, onLimit, count, disabled, onCheck } = props;
  return (
    <div className="flex items-center justify-end gap-2 border-t p-2">
      <label className="mr-auto flex items-center gap-1.5 text-sm text-muted-foreground">
        {t('At most')}
        <Input
          type="number"
          min={1}
          max={MAX_LIMIT}
          aria-label={t('At most')}
          className="h-6 w-20 font-mono"
          value={limit}
          onChange={(e) => onLimit(clampLimit(e.target.value))}
        />
      </label>
      <Button variant="primary" disabled={disabled} onClick={onCheck}>
        <Sparkles /> {t('Check {count} files', { count: formatCount(count) })}
      </Button>
    </div>
  );
}

/** Starting the check on every candidate found, and the job or the error it gave. */
function useRefreshRun(tag: string, search: RefreshCandidates | undefined) {
  const [startedJob, setStartedJob] = useState<Job>();
  const [startError, setStartError] = useState('');
  const start = async () => {
    setStartError('');
    const file_ids = search?.candidates.map((candidate) => candidate.id) ?? [];
    try {
      setStartedJob(await call('refresh_tag', { tag, file_ids }));
      void queryClient.invalidateQueries({ queryKey: ['status'] });
    } catch (e) {
      setStartError((e as Error).message);
    }
  };
  return { startedJob, startError, start };
}

/**
 * Refresh on one tag: the files that lack it but look like its files, why each was found, and what
 * checking them costs. Nothing is sent until Check, and nothing is tagged until Review.
 */
export function RefreshTag({ tag, onClose }: { tag: string; onClose: () => void }) {
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const { data: search, isLoading, error } = useTool('refresh_candidates', { tag, limit });
  const { data: status } = useTool('status', {});
  const { startedJob, startError, start } = useRefreshRun(tag, search);
  const missingKey = status ? needsKey(status) : false;
  const candidateCount = search?.candidates.length ?? 0;
  return (
    <Dialog open onClose={onClose} title={t('Refresh {tag}', { tag })} className="w-[42rem]">
      <div className="space-y-3 overflow-y-auto p-3">
        <p className="text-sm text-muted-foreground">
          {t(
            'Finds files without this tag that look like its files: by their words, the tags that go with it, and similar files. The decision model then checks each one, and the yeses wait in Review. Nothing is tagged until you accept.',
          )}
        </p>
        {isLoading && <p className="text-sm text-subtle">{t('Looking for candidates…')}</p>}
        {error && <ErrorText text={error.message} />}
        {search && <Findings search={search} running={!!startedJob} />}
        {missingKey && !startedJob && (
          <MissingKeyNotice provider={status?.provider ?? ''} onClose={onClose} />
        )}
        {startError && <ErrorText text={startError} />}
        {startedJob && <RunProgress startedJob={startedJob} tag={tag} onClose={onClose} />}
      </div>
      {!startedJob && (
        <CheckBar
          limit={limit}
          onLimit={setLimit}
          count={candidateCount}
          disabled={!candidateCount || missingKey}
          onCheck={() => void start()}
        />
      )}
    </Dialog>
  );
}
