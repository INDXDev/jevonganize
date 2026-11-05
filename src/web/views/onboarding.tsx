import { ArrowRight, Check, FolderOpen, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Job, Library } from '../../types.ts';
import { call, queryClient, useTool } from '../api.ts';
import { Block } from '../components/block.tsx';
import { FolderPicker } from '../components/folder-picker.tsx';
import { Button } from '../components/ui/button.tsx';
import { Checkbox, Input } from '../components/ui/field.tsx';
import { cn, formatCount, keyLabel, shortPath } from '../lib.ts';
import { useTabs, useWindow } from '../tabs.ts';

const FIRST_RUN = 200;

function Step(props: {
  n: number;
  title: string;
  done?: boolean;
  open: boolean;
  aside?: ReactNode;
  children?: ReactNode;
}) {
  const { n, title, done, open, aside, children } = props;
  return (
    <li className={cn('relative grid grid-cols-[2rem_minmax(0,1fr)] pb-7', !open && 'opacity-45')}>
      <span
        aria-hidden
        className={cn(
          'z-10 grid size-5 place-items-center rounded-sm border bg-surface-1 font-mono text-xs',
          done
            ? 'border-ok text-ok'
            : open
              ? 'border-primary text-primary'
              : 'border-control text-subtle',
        )}
      >
        {done ? <Check className="size-3" /> : n}
      </span>
      <div>
        <div className="flex h-5 items-center justify-between">
          <h2 className="text-lg font-medium">{title}</h2>
          {aside}
        </div>
        {open && <div className="mt-2 space-y-2">{children}</div>}
      </div>
    </li>
  );
}

const cost = (usd: number | null | undefined) =>
  usd === null ? 'cost unknown' : `about $${(usd ?? 0).toFixed(2)}`;

const packTitle = (id: string) => id[0]!.toUpperCase() + id.slice(1);

/** The first screen: key, folder, packs, then a cost notice. Nothing is tagged until a plan is approved. */
export function Onboarding() {
  const navigate = useTabs((s) => s.navigate);
  const { data: status } = useTool('status', {});
  const [key, setKey] = useState('');
  const [keySaved, setKeySaved] = useState(false);
  const [library, setLibrary] = useState<Library>();
  const [picking, setPicking] = useState(false);
  const [all, setAll] = useState(false);
  const [error, setError] = useState('');
  const [jobId, setJobId] = useState<string>();

  const { data: facets } = useTool('list_facets', {});
  const packs = useMemo(() => {
    const byPack = Map.groupBy(facets ?? [], (f) => f.pack);
    return [...byPack].map(([id, list]) => ({ id, on: list.some((f) => f.enabled) }));
  }, [facets]);

  const haveKey = keySaved || !!status?.has_key;
  const usable = library?.taggable === true;
  const query = { folder: library?.path, limit: all ? undefined : FIRST_RUN };
  const { data: estimate } = useTool('estimate', { query }, { enabled: usable });
  const { data: everything } = useTool(
    'estimate',
    { query: { folder: library?.path } },
    { enabled: usable },
  );

  const job: Job | undefined = status?.jobs.find((j) => j.id === jobId);
  const start = useRef<HTMLButtonElement>(null);

  // Enter on this button starts the run, as its hint says.
  useEffect(() => {
    if (usable) start.current?.focus();
  }, [usable]);

  useEffect(() => {
    if (job?.status !== 'done') return;
    useWindow.setState({ skipped: true });
    navigate('screen=review');
  }, [job?.status, navigate]);

  const guard = async (run: () => Promise<unknown>) => {
    setError('');
    try {
      await run();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const saveKey = () =>
    guard(async () => {
      await call('set_api_key', { provider: 'openai', key });
      setKey('');
      setKeySaved(true);
    });

  const pick = (path: string) => {
    setPicking(false);
    void guard(async () => {
      const added = await call('add_library', { path });
      setLibrary(added);
      if (added.taggable) await call('scan', { path: added.path });
    });
  };

  const togglePack = (id: string, enabled: boolean) =>
    guard(async () => {
      await call('set_enabled', { ids: [id], enabled });
      await queryClient.invalidateQueries({ queryKey: ['list_facets'] });
    });

  const organize = () =>
    guard(async () => {
      const started = await call('organize', { query });
      queryClient.setQueryData(
        ['status', {}],
        (s: typeof status) => s && { ...s, jobs: [started, ...s.jobs] },
      );
      setJobId(started.id);
    });

  const provider = status?.provider ?? 'your provider';

  return (
    <main className="dotgrid h-full overflow-y-auto bg-background">
      {/* No title bar here, so this strip is what moves the desktop window. */}
      <div aria-hidden className="app-drag fixed inset-x-0 top-0 h-titlebar" />
      <div className="mx-auto max-w-[42rem] px-6 py-12">
        <header className="mb-8">
          <h1 className="flex items-center gap-2.5 font-mono text-2xl tracking-tight">
            <img src="/icon.svg" alt="" className="size-8 rounded-md" /> jevonganize
          </h1>
          <p className="mt-2 text-md text-muted-foreground">
            It never moves, renames, edits or deletes a file. It only writes tags, and only after
            you approve a plan.
          </p>
        </header>

        <div className="rounded-lg border border-strong bg-surface-1 p-6">
          <ol className="relative before:absolute before:inset-y-3 before:left-2.5 before:w-px before:bg-strong">
            <Step
              n={1}
              title="OpenAI key"
              open
              done={haveKey}
              aside={
                <a
                  href="https://platform.openai.com/api-keys"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-subtle hover:text-foreground"
                >
                  Get a key ↗
                </a>
              }
            >
              {!haveKey && (
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveKey();
                  }}
                >
                  <Input
                    type="password"
                    autoComplete="off"
                    aria-label="OpenAI API key"
                    placeholder="sk-…"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    className="font-mono"
                  />
                  <Button type="submit" disabled={!key}>
                    Save
                  </Button>
                </form>
              )}
              <p className="text-xs text-subtle">
                {haveKey
                  ? 'Stored in a file only you can read.'
                  : 'Without one, you can still scan and browse.'}
              </p>
            </Step>

            <Step n={2} title="Folder" open done={usable}>
              <div className="flex items-center gap-2">
                <Button onClick={() => setPicking(true)}>
                  <FolderOpen /> {library ? 'Change' : 'Choose a folder'}
                </Button>
                {library && (
                  <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                    {shortPath(library.path)} · {formatCount(library.files)} files found
                  </span>
                )}
              </div>
              {library && !library.taggable && (
                <p className="flex items-center gap-1.5 text-xs text-warn">
                  <TriangleAlert className="size-3" /> This volume cannot store tags. Pick another
                  folder.
                </p>
              )}
            </Step>

            <Step n={3} title="Packs" open={usable} done={usable}>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {packs.map((p) => (
                  <label key={p.id} className="flex items-center gap-1.5 text-sm">
                    <Checkbox
                      checked={p.on}
                      onCheckedChange={(on) => void togglePack(p.id, on === true)}
                    />
                    {packTitle(p.id)}
                  </label>
                ))}
              </div>
            </Step>

            <Step n={4} title="Before you start" open={usable}>
              <p className="text-sm text-muted-foreground">
                Sent to {provider} for each file: its name, up to 8,000 characters of text, up to 2
                images, and metadata. Nothing else.
              </p>
              {estimate && (
                <p className="font-mono text-xs">
                  {all ? 'All' : 'First'} {formatCount(estimate.files)} files · {estimate.facets}{' '}
                  facets · {(estimate.tokens / 1e6).toFixed(1)}M tokens · {cost(estimate.cost_usd)}
                </p>
              )}
              {everything && everything.files > FIRST_RUN && (
                <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Checkbox checked={all} onCheckedChange={(on) => setAll(on === true)} />
                  All {formatCount(everything.files)} files, {cost(everything.cost_usd)}
                </label>
              )}
            </Step>
          </ol>

          {job && <Block job={job} />}
          {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
          <footer className="mt-3 flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                useWindow.setState({ skipped: true });
                navigate('');
              }}
            >
              Skip for now
            </Button>
            <Button
              variant="primary"
              ref={start}
              disabled={!usable || !haveKey || !!job}
              onClick={() => void organize()}
            >
              Organize <ArrowRight />{' '}
              <span className="font-mono text-2xs opacity-70">{keyLabel('enter')}</span>
            </Button>
          </footer>
        </div>
      </div>
      <FolderPicker open={picking} onClose={() => setPicking(false)} onPick={pick} />
    </main>
  );
}
