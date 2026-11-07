import { t } from '../i18n/index.ts';
import { RefreshCw, Sparkles } from 'lucide-react';
import { useState } from 'react';
import type { Job, RefreshCandidate, RefreshCandidates } from '../../types.ts';
import { call, queryClient, useTool } from '../api.ts';
import { Block } from '../components/block.tsx';
import { SendNotice } from '../components/send-notice.tsx';
import { TagChip } from '../components/tag-chip.tsx';
import { Button } from '../components/ui/button.tsx';
import { Dialog } from '../components/ui/dialog.tsx';
import { Input } from '../components/ui/field.tsx';
import { formatCount, needsKey } from '../lib.ts';
import { setView } from '../tabs.ts';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** The button that opens a refresh. The onboarding tour points at `data-tour="tag-refresh"`. */
export function RefreshButton(props: { tag: string; onClick: () => void; label?: boolean }) {
  const { tag, onClick, label } = props;
  return (
    <Button
      variant="ghost"
      icon={!label}
      className={label ? 'h-6' : 'size-6'}
      data-tour="tag-refresh"
      aria-label={t('Refresh {tag}', { tag })}
      title={t('Find files that should have this tag, and check them')}
      onClick={onClick}
    >
      <RefreshCw /> {label && t('Refresh')}
    </Button>
  );
}

function signalWords({ signals }: RefreshCandidate): string[] {
  return [
    ...signals.terms.slice(0, 3),
    ...signals.tags.slice(0, 2),
    ...(signals.similar > 0 ? [t('similar {score}', { score: signals.similar.toFixed(2) })] : []),
    ...(signals.name ? [t('file name')] : []),
  ];
}

function CandidateList({ found }: { found: RefreshCandidates }) {
  return (
    <ul className="max-h-60 divide-y overflow-y-auto rounded-md border">
      {found.candidates.map((candidate) => (
        <li key={candidate.id} className="flex h-row items-center gap-2 px-2 text-sm">
          <span className="w-10 font-mono text-xs text-subtle">{candidate.score.toFixed(2)}</span>
          <span className="min-w-0 flex-1 truncate" title={candidate.path}>
            {candidate.name}
          </span>
          <span className="max-w-[45%] truncate font-mono text-xs text-subtle">
            {signalWords(candidate).join(' · ')}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** What the search learned from the tagged files: its words and the tags that go with this one. */
function Learned({ found }: { found: RefreshCandidates }) {
  if (!found.terms.length && !found.tags.length) return null;
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      {found.terms.length > 0 && (
        <p>
          {t('Words')}: <span className="font-mono">{found.terms.join(', ')}</span>
        </p>
      )}
      {found.tags.length > 0 && (
        <p className="flex flex-wrap items-center gap-1">
          {t('Tags that go with it')}:{' '}
          {found.tags.slice(0, 6).map((tag) => (
            <TagChip key={tag} tag={tag} />
          ))}
        </p>
      )}
    </div>
  );
}

function Empty({ found }: { found: RefreshCandidates }) {
  return (
    <p className="text-sm text-muted-foreground">
      {found.tagged === 0
        ? t('No file has this tag yet, so only file names were searched. Nothing matched.')
        : t('No candidates. Files like these already have the tag, or were checked already.')}
    </p>
  );
}

function Finished({ job, tag, onClose }: { job: Job; tag: string; onClose: () => void }) {
  const reviews = job.reviews ?? 0;
  if (job.status !== 'done') return null;
  if (reviews === 0) {
    return <p className="text-sm text-muted-foreground">{t('No file needs review.')}</p>;
  }
  return (
    <Button
      variant="primary"
      onClick={() => {
        onClose();
        setView({ screen: 'review', tag: [tag], section: null });
      }}
    >
      {t('{count} files to review', { count: formatCount(reviews) })}
    </Button>
  );
}

/** The run of a refresh, once started: its progress, then the way into Review. */
function RunState(props: { jobId: string; started: Job; tag: string; onClose: () => void }) {
  const { jobId, started, tag, onClose } = props;
  const { data: status } = useTool('status', {});
  const job = status?.jobs.find((entry) => entry.id === jobId) ?? started;
  return (
    <div className="space-y-2">
      <Block job={job} />
      <Finished job={job} tag={tag} onClose={onClose} />
    </div>
  );
}

/**
 * Refresh on one tag: the files that lack it but look like its files, why each was found, and what
 * checking them costs. Nothing is sent until Check, and nothing is tagged until Review.
 */
export function RefreshTag({ tag, onClose }: { tag: string; onClose: () => void }) {
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [started, setStarted] = useState<Job>();
  const [problem, setProblem] = useState('');
  const { data: found, isLoading, error } = useTool('refresh_candidates', { tag, limit });
  const { data: status } = useTool('status', {});
  const missingKey = status ? needsKey(status) : false;
  const count = found?.candidates.length ?? 0;
  const start = async () => {
    setProblem('');
    const file_ids = found?.candidates.map((candidate) => candidate.id) ?? [];
    try {
      setStarted(await call('refresh_tag', { tag, file_ids }));
      void queryClient.invalidateQueries({ queryKey: ['status'] });
    } catch (e) {
      setProblem((e as Error).message);
    }
  };
  return (
    <Dialog open onClose={onClose} title={t('Refresh {tag}', { tag })} className="w-[42rem]">
      <div className="space-y-3 overflow-y-auto p-3">
        <p className="text-sm text-muted-foreground">
          {t(
            'Finds files without this tag that look like its files: by their words, the tags that go with it, and similar files. The decision model then checks each one, and the yeses wait in Review. Nothing is tagged until you accept.',
          )}
        </p>
        {isLoading && <p className="text-sm text-subtle">{t('Looking for candidates…')}</p>}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
        )}
        {found && (
          <>
            <p className="font-mono text-xs">
              {t('{tagged} files have it · {count} candidates · {checked} already checked', {
                tagged: formatCount(found.tagged),
                count: formatCount(count),
                checked: formatCount(found.checked),
              })}
            </p>
            <Learned found={found} />
            {count ? <CandidateList found={found} /> : <Empty found={found} />}
            {count > 0 && !started && (
              <SendNotice estimate={found.estimate} provider={found.estimate.provider} />
            )}
          </>
        )}
        {missingKey && !started && (
          <p className="text-sm text-warn">
            {t('No API key for {provider}.', { provider: status?.provider ?? '' })}{' '}
            <button
              type="button"
              className="underline"
              onClick={() => {
                onClose();
                setView({ screen: 'settings', section: 'keys' });
              }}
            >
              {t('Add one in Settings')}
            </button>
          </p>
        )}
        {problem && (
          <p role="alert" className="text-sm text-destructive">
            {problem}
          </p>
        )}
        {started && <RunState jobId={started.id} started={started} tag={tag} onClose={onClose} />}
      </div>
      {!started && (
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
              onChange={(e) =>
                setLimit(Math.min(Math.max(Number(e.target.value) || 1, 1), MAX_LIMIT))
              }
            />
          </label>
          <Button variant="primary" disabled={!count || missingKey} onClick={() => void start()}>
            <Sparkles /> {t('Check {count} files', { count: formatCount(count) })}
          </Button>
        </div>
      )}
    </Dialog>
  );
}
