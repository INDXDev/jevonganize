import { t } from '../i18n/index.ts';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Job, Library, Status } from '../../types.ts';
import {
  addTopics,
  call,
  chooseTopics,
  organize as startOrganize,
  queryClient,
  useTool,
} from '../api.ts';
import { Block } from '../components/block.tsx';
import { FolderPicker } from '../components/folder-picker.tsx';
import { useTabs, useWindow } from '../tabs.ts';
import { patchQuery } from '../view-query.ts';
import {
  CostStep,
  FIRST_RUN,
  FolderStep,
  Intro,
  KeyStep,
  PacksStep,
  StartBar,
  TopicsStep,
} from './onboarding-steps.tsx';

type Guard = (run: () => Promise<unknown>) => Promise<void>;

/** The last failure, and a wrapper that clears it, runs a mutation and records what it threw. */
function useGuard() {
  const [error, setError] = useState('');
  const guard: Guard = async (run) => {
    setError('');
    try {
      await run();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return { error, guard };
}

function useApiKey(status: Status | undefined, guard: Guard) {
  const [key, setKey] = useState('');
  const [keySaved, setKeySaved] = useState(false);
  const saveKey = () =>
    guard(async () => {
      await call('set_api_key', { provider: 'openai', key });
      setKey('');
      setKeySaved(true);
    });
  // Keys in the environment wait for consent. This button is that consent.
  const { data: keys } = useTool('list_keys', {});
  const openai = keys?.keys.find((row) => row.provider === 'openai');
  const adoptEnvKey = () =>
    guard(async () => {
      await call('set_env_keys', { allowed: true });
      await queryClient.invalidateQueries({ queryKey: ['list_keys'] });
      setKeySaved(true);
    });
  return {
    key,
    setKey,
    saveKey,
    inEnv: openai?.in_env === true,
    fromEnv: openai?.source === 'env',
    adoptEnvKey,
    haveKey: keySaved || !!status?.has_key,
  };
}

function useFolderChoice(guard: Guard) {
  const [library, setLibrary] = useState<Library>();
  const [picking, setPicking] = useState(false);
  const pick = (path: string) => {
    setPicking(false);
    void guard(async () => {
      const added = await call('add_library', { path });
      setLibrary(added);
      if (added.taggable) await call('scan', { path: added.path });
    });
  };
  return { library, picking, setPicking, pick, usable: library?.taggable === true };
}

function usePacks(guard: Guard) {
  const { data: facets } = useTool('list_facets', {});
  const packs = useMemo(() => {
    const byPack = Map.groupBy(facets ?? [], (f) => f.pack);
    return [...byPack].map(([id, list]) => ({ id, on: list.some((f) => f.enabled) }));
  }, [facets]);
  const togglePack = (id: string, enabled: boolean) =>
    guard(async () => {
      await call('set_enabled', { ids: [id], enabled });
      await queryClient.invalidateQueries({ queryKey: ['list_facets'] });
    });
  return { packs, togglePack };
}

/** The first run: topics from the catalog, organize, then proper names, with nothing to approve. */
function useFirstRun(input: { library?: Library; usable: boolean; status?: Status; guard: Guard }) {
  const { library, usable, status, guard } = input;
  const navigate = useTabs((s) => s.navigate);
  const [coverAll, setCoverAll] = useState(false);
  const [jobId, setJobId] = useState<string>();
  const [picking, setPicking] = useState(false);
  // Unset until a person or the model has chosen, so Organize knows to choose. Empty is a choice.
  const [topics, setTopics] = useState<string[]>();

  const query = { folder: library?.path, limit: coverAll ? undefined : FIRST_RUN };
  const { data: estimate } = useTool('estimate', { query }, { enabled: usable });
  const { data: wholeFolder } = useTool(
    'estimate',
    { query: { folder: library?.path } },
    { enabled: usable },
  );

  const job: Job | undefined = status?.jobs.find((j) => j.id === jobId);
  const startRef = useRef<HTMLButtonElement>(null);

  // Enter on this button starts the run, as its hint says.
  useEffect(() => {
    if (usable) startRef.current?.focus();
  }, [usable]);

  useEffect(() => {
    if (job?.status !== 'done') return;
    useWindow.setState({ skipped: true });
    navigate(patchQuery('', { screen: 'names', folder: library?.path }));
  }, [job?.status, navigate, library?.path]);

  const choose = async () => {
    setPicking(true);
    try {
      const chosen = await chooseTopics(library?.path);
      setTopics((now) => [...new Set([...(now ?? []), ...chosen])]);
      return chosen;
    } finally {
      setPicking(false);
    }
  };

  const startRun = () =>
    guard(async () => {
      await addTopics(topics ?? (await choose()));
      setJobId((await startOrganize({ query }, true)).id);
    });

  return {
    coverAll,
    setCoverAll,
    estimate,
    wholeFolder,
    job,
    picking,
    topics: topics ?? [],
    setTopics,
    choose: () => guard(choose),
    startRef,
    startRun,
  };
}

/** The first screen: key, folder, packs, topics, then a cost notice. Starting the run writes tags, which undo reverses. */
export function Onboarding() {
  const navigate = useTabs((s) => s.navigate);
  const { data: status } = useTool('status', {});
  const { error, guard } = useGuard();
  const { key, setKey, saveKey, inEnv, fromEnv, adoptEnvKey, haveKey } = useApiKey(status, guard);
  const { library, picking, setPicking, pick, usable } = useFolderChoice(guard);
  const { packs, togglePack } = usePacks(guard);
  const run = useFirstRun({ library, usable, status, guard });

  const skip = () => {
    useWindow.setState({ skipped: true });
    navigate('');
  };

  return (
    <main className="dotgrid h-full overflow-y-auto bg-background">
      {/* No title bar here, so this strip is what moves the desktop window. */}
      <div aria-hidden className="app-drag fixed inset-x-0 top-0 h-titlebar" />
      <div className="mx-auto max-w-[42rem] px-6 py-12">
        <Intro />
        <div className="rounded-lg border border-strong bg-surface-1 p-6">
          <ol className="relative before:absolute before:inset-y-3 before:left-2.5 before:w-px before:bg-strong">
            <KeyStep
              haveKey={haveKey}
              value={key}
              onChange={setKey}
              onSave={() => void saveKey()}
              inEnv={inEnv}
              fromEnv={fromEnv}
              onUseEnv={() => void adoptEnvKey()}
            />
            <FolderStep
              library={library}
              files={run.wholeFolder?.files}
              usable={usable}
              onChoose={() => setPicking(true)}
            />
            <PacksStep
              usable={usable}
              packs={packs}
              onToggle={(id, enabled) => void togglePack(id, enabled)}
            />
            <TopicsStep
              usable={usable}
              canChoose={haveKey && !run.job}
              picking={run.picking}
              topics={run.topics}
              onChange={run.setTopics}
              onChoose={() => void run.choose()}
            />
            <CostStep
              usable={usable}
              provider={status?.provider ?? t('your provider')}
              estimate={run.estimate}
              wholeFolder={run.wholeFolder}
              coverAll={run.coverAll}
              onCoverAll={run.setCoverAll}
            />
          </ol>

          {run.job && <Block job={run.job} />}
          {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
          <StartBar
            startRef={run.startRef}
            canStart={usable && haveKey && !run.job && !run.picking}
            onSkip={skip}
            onStart={() => void run.startRun()}
          />
        </div>
      </div>
      <FolderPicker open={picking} onClose={() => setPicking(false)} onPick={pick} />
    </main>
  );
}
