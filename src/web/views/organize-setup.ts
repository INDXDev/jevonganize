import { useMemo, useState } from 'react';
import type { FacetInfo, Job } from '../../types.ts';
import { organize, useTool, useViewOptions } from '../api.ts';
import { needsKey } from '../lib.ts';
import { useView } from '../tabs.ts';
import { useViewScope } from '../vfolder-query.ts';
import { newestFirst } from './organize-run.tsx';

const enabledIds = (facets: FacetInfo[]) =>
  new Set(facets.filter((facet) => facet.enabled).map((facet) => facet.id));

const isRunningOrganize = (job: Job) => job.kind === 'organize' && job.status === 'running';

/** The run being set up: its scope, facets and estimate, and the call that starts it. */
export function useRunSetup() {
  const view = useView();
  const { data: status } = useTool('status', {});
  const { data: facets = [] } = useTool('list_facets', {});
  const { data: libraries = [] } = useTool('list_libraries', {});
  const options = useViewOptions();
  const [limit, setLimit] = useState<number>();
  // Unset until a tick changes, so the run uses the enabled facets and sends no `facets`.
  const [picked, setPicked] = useState<Set<string>>();
  const [apply, setApply] = useState(true);
  const [startError, setStartError] = useState('');

  const enabled = useMemo(() => enabledIds(facets), [facets]);
  const chosen = picked ?? enabled;
  const scope = useViewScope(view, options);
  const input = { query: { ...scope, limit }, facets: picked && [...picked] };
  const { data: estimate, error: estimateError } = useTool('estimate', input, {
    enabled: !!scope,
  });

  const jobs = (status?.jobs ?? []).toSorted(newestFirst);
  const isBusy = jobs.some(isRunningOrganize);
  const missingKey = status ? needsKey(status) : false;
  const hasFiles = !!estimate?.files;
  const canStart = !isBusy && !missingKey && chosen.size > 0 && hasFiles;
  const start = async () => {
    setStartError('');
    await organize(input, apply).catch((e: Error) => setStartError(e.message));
  };

  return {
    view,
    status,
    facets,
    libraries,
    limit,
    setLimit,
    picked,
    setPicked,
    apply,
    setApply,
    canChoose: !missingKey,
    startError,
    chosen,
    estimate,
    estimateError,
    jobs,
    missingKey,
    canStart,
    start,
  };
}

/** Everything the setup pane shows and changes. */
export type RunSetup = ReturnType<typeof useRunSetup>;
