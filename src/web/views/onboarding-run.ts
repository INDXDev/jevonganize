import { useEffect, useRef, useState } from 'react';
import type { Job, Library, Status } from '../../types.ts';
import { addTopics, chooseTopics, organize as startOrganize, useTool } from '../api.ts';
import { useTabs, useWindow } from '../tabs.ts';
import { patchQuery } from '../view-query.ts';
import type { RunRecordingError } from './onboarding-state.ts';
import { FIRST_RUN } from './onboarding-steps.tsx';

/** The topics the first run adds, and asking the model to choose some from the catalog. */
function useTopics(folder: string | undefined) {
  const [isChoosing, setIsChoosing] = useState(false);
  // Unset until a person or the model has chosen, so Organize knows to choose. Empty is a choice.
  const [topics, setTopics] = useState<string[]>();
  const chooseWithModel = async () => {
    setIsChoosing(true);
    try {
      const chosen = await chooseTopics(folder);
      setTopics((current) => {
        const merged = new Set([...(current ?? []), ...chosen]);
        return [...merged];
      });
      return chosen;
    } finally {
      setIsChoosing(false);
    }
  };
  return { topics, setTopics, isChoosing, chooseWithModel };
}

/** A ref whose element takes focus once `ready` turns true. Enter on the start button then starts the run, as its hint says. */
function useFocusWhen<T extends HTMLElement>(ready: boolean) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (ready) ref.current?.focus();
  }, [ready]);
  return ref;
}

/** When the first run is done, leaves onboarding for the names it found. */
function useLeaveWhenDone(job: Job | undefined, folder: string | undefined) {
  const navigate = useTabs((s) => s.navigate);
  useEffect(() => {
    if (job?.status !== 'done') return;
    useWindow.setState({ skipped: true });
    navigate(patchQuery('', { screen: 'tags', section: 'names', folder }));
  }, [job?.status, navigate, folder]);
}

/** The first run: topics from the catalog, organize, then proper names, with nothing to approve. */
export function useFirstRun(input: {
  library?: Library;
  isTaggable: boolean;
  status?: Status;
  runRecordingError: RunRecordingError;
}) {
  const { library, isTaggable, status, runRecordingError } = input;
  const folder = library?.path;
  const [coverAll, setCoverAll] = useState(false);
  const [jobId, setJobId] = useState<string>();
  const { topics, setTopics, isChoosing, chooseWithModel } = useTopics(folder);

  // The first run covers a sample of the folder unless the person chose all of it.
  const runQuery = { folder, limit: coverAll ? undefined : FIRST_RUN };
  const enabled = { enabled: isTaggable };
  const { data: estimate } = useTool('estimate', { query: runQuery }, enabled);
  const { data: wholeFolder } = useTool('estimate', { query: { folder } }, enabled);

  const job: Job | undefined = status?.jobs.find((entry) => entry.id === jobId);
  const startRef = useFocusWhen<HTMLButtonElement>(isTaggable);
  useLeaveWhenDone(job, folder);

  const startRun = () =>
    runRecordingError(async () => {
      // With no topics chosen yet, the model chooses them first.
      const topicsToAdd = topics ?? (await chooseWithModel());
      await addTopics(topicsToAdd);
      const organizeJob = await startOrganize({ query: runQuery }, true);
      setJobId(organizeJob.id);
    });

  return {
    coverAll,
    setCoverAll,
    estimate,
    wholeFolder,
    job,
    isChoosing,
    topics: topics ?? [],
    setTopics,
    askModelForTopics: () => runRecordingError(chooseWithModel),
    startRef,
    startRun,
  };
}
