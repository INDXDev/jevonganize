import { t } from '../i18n/index.ts';
import { FolderSync, Sparkles } from 'lucide-react';
import type { Library } from '../../types.ts';
import { scanFolder } from '../api.ts';
import { Filters } from '../components/filters.tsx';
import { SendNotice } from '../components/send-notice.tsx';
import { Button } from '../components/ui/button.tsx';
import { Dialog } from '../components/ui/dialog.tsx';
import { Field, Input, Select, Switch } from '../components/ui/field.tsx';
import { formatCount, shortPath } from '../lib.ts';
import { setView } from '../tabs.ts';
import type { View } from '../view-query.ts';
import { FacetPicker } from './organize-facets.tsx';
import { Run } from './organize-run.tsx';
import { useRunSetup, type RunSetup } from './organize-setup.ts';
import { TopicsField } from './organize-vocabulary.tsx';

/** The folder choice that means every library. Real choices are paths. */
const ALL_LIBRARIES = '__all';

/** Every library, plus the open folder when it is not one, after "All libraries". */
function folderOptions(libraries: Library[], current?: string) {
  const currentPaths = current ? [current] : [];
  const paths = new Set([...libraries.map((library) => library.path), ...currentPaths]);
  return [
    { value: ALL_LIBRARIES, label: t('All libraries') },
    ...[...paths].map((path) => ({ value: path, label: shortPath(path) })),
  ];
}

function FolderField({ view, libraries }: { view: View; libraries: Library[] }) {
  return (
    <Field label={t('Folder')}>
      <span className="flex items-center gap-2">
        <Select
          label={t('Folder')}
          className="w-64 font-mono text-xs"
          value={view.folder ?? ALL_LIBRARIES}
          options={folderOptions(libraries, view.folder)}
          onChange={(folder) => setView({ folder: folder === ALL_LIBRARIES ? null : folder })}
        />
        <Button onClick={() => void scanFolder(view.folder)}>
          <FolderSync /> {t('Scan')}
        </Button>
      </span>
      {view.vfolder && (
        <span className="mt-1 flex items-center gap-2 text-xs text-subtle">
          {t('Only files in the virtual folder {name}', { name: view.vname ?? view.vfolder })}
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => setView({ vfolder: null, vname: null })}
          >
            {t('Leave the folder')}
          </button>
        </span>
      )}
    </Field>
  );
}

function MissingKey({ provider }: { provider?: string }) {
  return (
    <p className="text-sm text-warn">
      {t('No API key for {provider}.', { provider: provider ?? t('your provider') })}{' '}
      <button
        type="button"
        className="underline"
        onClick={() => setView({ screen: 'settings', section: 'keys' })}
      >
        {t('Add one in Settings')}
      </button>
    </p>
  );
}

/** What the run sends and costs, and when its tags are written. */
function BeforeYouStart({ setup }: { setup: RunSetup }) {
  const writeNote = setup.apply
    ? t(
        'Tags are written when the run ends, and undo reverses them. Answers are cached, so running the same files again costs nothing.',
      )
    : t(
        'Nothing is written until you apply the plan. Answers are cached, so running the same files again costs nothing.',
      );
  return (
    <section className="space-y-1.5 border-t pt-3">
      <h3 className="label">{t('Before you start')}</h3>
      <SendNotice
        estimate={setup.estimate}
        provider={setup.status?.provider ?? t('your provider')}
      />
      <p className="text-sm text-muted-foreground"> {writeNote} </p>
    </section>
  );
}

/** The body of the setup pane: scope, facets, the send notice and anything in the way. */
function SetupForm({ setup }: { setup: RunSetup }) {
  const { view, status, picked, startError, estimateError } = setup;
  const errorText = startError || estimateError?.message;
  const facetsHelp = picked
    ? t('For this run only. Settings stay as they are.')
    : t('The enabled facets. Tick others for this run only.');
  return (
    <div className="space-y-1 p-4">
      <FolderField view={view} libraries={setup.libraries} />
      <Filters view={view} className="pb-2" />
      <Field
        label={t('Limit')}
        help={t('Organize at most this many files. Empty means all of them.')}
      >
        <Input
          type="number"
          min={1}
          aria-label={t('Limit')}
          placeholder={t('All')}
          className="w-28 font-mono"
          value={setup.limit ?? ''}
          onChange={(e) => setup.setLimit(Number(e.target.value) || undefined)}
        />
      </Field>
      <Field label={t('Facets')} help={facetsHelp}>
        <FacetPicker facets={setup.facets} chosen={setup.chosen} onChange={setup.setPicked} />
      </Field>
      <TopicsField folder={view.folder} canChoose={setup.canChoose} />
      <BeforeYouStart setup={setup} />
      {setup.missingKey && <MissingKey provider={status?.provider} />}
      {errorText && (
        <p role="alert" className="text-sm text-destructive">
          {errorText}
        </p>
      )}
    </div>
  );
}

function StartBar({ setup }: { setup: RunSetup }) {
  const { apply, setApply, canStart, estimate, start } = setup;
  return (
    <div className="flex items-center justify-end gap-3 p-2">
      <span className="mr-auto flex items-center gap-1.5 text-sm text-muted-foreground">
        <Switch aria-label={t('Apply when ready')} checked={apply} onCheckedChange={setApply} />
        {t('Apply when ready')}
      </span>
      <Button variant="primary" disabled={!canStart} onClick={() => void start()}>
        <Sparkles />{' '}
        {t('Organize {count} files', { count: estimate ? formatCount(estimate.files) : '—' })}
      </Button>
    </div>
  );
}

/**
 * `organize` as a drawer over Tags: choose the files and facets, see the cost, then watch it run.
 * It is open while `section=organize`, so old Organize links open it. A run keeps going when it closes,
 * in the status bar and the Dashboard.
 */
export function OrganizeDrawer({ onClose }: { onClose: () => void }) {
  const setup = useRunSetup();
  const { jobs } = setup;
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('Organize')}
      className="top-0 right-0 left-auto h-full max-h-none w-[min(40rem,100vw)] translate-x-0 rounded-none border-y-0 border-r-0"
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        <SetupForm setup={setup} />
        <section className="border-t">
          <h3 className="label px-4 pt-3">{t('Run')}</h3>
          {jobs.length ? (
            <Run jobs={jobs} />
          ) : (
            <p className="p-4 text-sm text-subtle">
              {t('Nothing has run yet. Progress appears here.')}
            </p>
          )}
        </section>
      </div>
      <footer className="shrink-0 border-t">
        <StartBar setup={setup} />
      </footer>
    </Dialog>
  );
}
