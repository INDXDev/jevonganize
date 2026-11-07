import { t } from '../i18n/index.ts';
import type { RefreshCandidate, RefreshCandidates } from '../../types.ts';
import { SendNotice } from '../components/send-notice.tsx';
import { TagChip } from '../components/tag-chip.tsx';
import { formatCount } from '../lib.ts';

/** The few signals that best explain why a candidate was found. */
function signalWords({ signals }: RefreshCandidate): string[] {
  const similarity =
    signals.similar > 0 ? [t('similar {score}', { score: signals.similar.toFixed(2) })] : [];
  const nameMatch = signals.name ? [t('file name')] : [];
  return [...signals.terms.slice(0, 3), ...signals.tags.slice(0, 2), ...similarity, ...nameMatch];
}

function CandidateList({ search }: { search: RefreshCandidates }) {
  return (
    <ul className="max-h-60 divide-y overflow-y-auto rounded-md border">
      {search.candidates.map((candidate) => (
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
function Learned({ search }: { search: RefreshCandidates }) {
  const hasTerms = search.terms.length > 0;
  const hasTags = search.tags.length > 0;
  if (!hasTerms && !hasTags) return null;
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      {hasTerms && (
        <p>
          {t('Words')}: <span className="font-mono">{search.terms.join(', ')}</span>
        </p>
      )}
      {hasTags && (
        <p className="flex flex-wrap items-center gap-1">
          {t('Tags that go with it')}:{' '}
          {search.tags.slice(0, 6).map((tag) => (
            <TagChip key={tag} tag={tag} />
          ))}
        </p>
      )}
    </div>
  );
}

function NoCandidates({ search }: { search: RefreshCandidates }) {
  return (
    <p className="text-sm text-muted-foreground">
      {search.tagged === 0
        ? t('No file has this tag yet, so only file names were searched. Nothing matched.')
        : t('No candidates. Files like these already have the tag, or were checked already.')}
    </p>
  );
}

/** What the search found: counts, what it learned, the candidates and what checking them sends. */
export function Findings({ search, running }: { search: RefreshCandidates; running: boolean }) {
  const candidateCount = search.candidates.length;
  return (
    <>
      <p className="font-mono text-xs">
        {t('{tagged} files have it · {count} candidates · {checked} already checked', {
          tagged: formatCount(search.tagged),
          count: formatCount(candidateCount),
          checked: formatCount(search.checked),
        })}
      </p>
      <Learned search={search} />
      {candidateCount ? <CandidateList search={search} /> : <NoCandidates search={search} />}
      {candidateCount > 0 && !running && (
        <SendNotice estimate={search.estimate} provider={search.estimate.provider} />
      )}
    </>
  );
}
