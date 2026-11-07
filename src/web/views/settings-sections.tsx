import { t } from '../i18n/index.ts';
import { Check, Copy, Trash2, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { act, useTool } from '../api.ts';
import { FolderPicker } from '../components/folder-picker.tsx';
import { Button } from '../components/ui/button.tsx';
import { Field, Input, Segmented, Select, Switch } from '../components/ui/field.tsx';
import { formatCount, shortPath } from '../lib.ts';
import { notify, useWindow, type Theme } from '../tabs.ts';
import { startTour } from '../tour.ts';
import type { ProviderName } from '../../types.ts';
import type { Section } from './settings-layout.ts';

const SOURCE = { env: 'From the environment', file: 'Stored in a file only you can read' } as const;

function Keys() {
  const { data } = useTool('list_keys', {});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const replace = async (provider: ProviderName) => {
    await act('set_api_key', { provider, key: drafts[provider] ?? '' });
    setDrafts({ ...drafts, [provider]: '' });
    notify(t('Key saved for {provider}', { provider }));
  };
  return (
    <>
      {data?.keys.map(({ provider, source }) => (
        <Field key={provider} label={provider} help={source ? t(SOURCE[source]) : t('No key')}>
          <span className="flex max-w-96 gap-2">
            <Input
              type="password"
              autoComplete="off"
              aria-label={t('{provider} key', { provider })}
              placeholder={source ? t('Replace key') : t('Add key')}
              value={drafts[provider] ?? ''}
              onChange={(e) => setDrafts({ ...drafts, [provider]: e.target.value })}
            />
            <Button disabled={!drafts[provider]} onClick={() => void replace(provider)}>
              {t('Save')}
            </Button>
            {source === 'file' && (
              <Button variant="danger" onClick={() => void act('remove_api_key', { provider })}>
                {t('Remove')}
              </Button>
            )}
          </span>
        </Field>
      ))}
      <Field
        label={t('Keys from the environment')}
        help={t('Lets a key in a variable such as OPENAI_API_KEY be used.')}
      >
        <Switch
          aria-label={t('Keys from the environment')}
          checked={data?.env_allowed === true}
          onCheckedChange={(allowed) => void act('set_env_keys', { allowed })}
        />
      </Field>
    </>
  );
}

function Health() {
  const { data: checks, isFetching, refetch } = useTool('doctor', {});
  const { data } = useTool('get_config', {});
  return (
    <div className="space-y-4">
      <ul className="max-w-2xl divide-y rounded-md border">
        {checks?.map((check) => (
          <li
            key={`${check.name} ${check.detail}`}
            className="flex items-center gap-2 px-2.5 py-1.5"
          >
            {check.ok ? (
              <Check aria-label={t('ok')} className="size-3.5 shrink-0 text-ok" />
            ) : (
              <X aria-label={t('failed')} className="size-3.5 shrink-0 text-destructive" />
            )}
            <span className="min-w-0 truncate font-mono text-xs">{check.detail}</span>
          </li>
        ))}
      </ul>
      <Button disabled={isFetching} onClick={() => void refetch()}>
        {t('Check again')}
      </Button>
      <section>
        <h3 className="label mb-1">{t('Where things are')}</h3>
        <dl className="grid max-w-2xl grid-cols-[4rem_minmax(0,1fr)] gap-y-0.5 text-sm">
          {Object.entries(data?.paths ?? {}).map(([key, path]) => (
            <div key={key} className="contents">
              <dt className="text-subtle">{key}</dt>
              <dd className="font-mono text-xs break-all text-muted-foreground">{path}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

function Libraries() {
  const { data = [] } = useTool('list_libraries', {});
  const [picking, setPicking] = useState(false);
  return (
    <>
      <ul className="max-w-xl divide-y rounded-md border">
        {data.map(({ path, files }) => (
          <li key={path} className="flex items-center gap-3 px-2.5 py-1.5">
            <span className="min-w-0 flex-1 truncate font-mono text-xs">{shortPath(path)}</span>
            <span className="font-mono text-xs text-subtle">
              {t('{count} files', { count: formatCount(files) })}
            </span>
            <Button variant="ghost" onClick={() => void act('scan', { path })}>
              {t('Scan')}
            </Button>
            <Button
              variant="ghost"
              icon
              aria-label={t('Remove {tag}', { tag: path })}
              title={t('Clears the index only. Tags stay.')}
              onClick={() => void act('remove_library', { path })}
            >
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
      <Button className="mt-2" onClick={() => setPicking(true)}>
        {t('Add a folder')}
      </Button>
      <p className="mt-1 text-xs text-subtle">{t('Removing clears the index only. Tags stay.')}</p>
      <FolderPicker
        open={picking}
        onClose={() => setPicking(false)}
        onPick={(path) => {
          setPicking(false);
          void act('add_library', { path }).then(
            (library) => library && act('scan', { path: library.path }),
          );
        }}
      />
    </>
  );
}

function Snippet({ label, code }: { label: string; code: string }) {
  return (
    <div className="max-w-2xl">
      <h4 className="mb-1 text-sm text-muted-foreground">{label}</h4>
      <div className="flex items-start gap-2 rounded-md border bg-surface-2 p-2">
        <code className="min-w-0 flex-1 font-mono text-xs break-all whitespace-pre-wrap">
          {code}
        </code>
        <Button
          variant="ghost"
          icon
          aria-label={t('Copy {label}', { label })}
          onClick={() => void navigator.clipboard.writeText(code).then(() => notify(t('Copied')))}
        >
          <Copy />
        </Button>
      </div>
    </div>
  );
}

function Agents() {
  return (
    <div className="space-y-3">
      <p className="max-w-2xl text-sm text-muted-foreground">
        {' '}
        {t(
          "Your client's model sees names, paths and tags. Plans it proposes wait in Review for you.",
        )}{' '}
      </p>
      <Snippet label={t('Claude Code')} code="claude mcp add jevonganize -- jevonganize mcp" />
      <Snippet
        label={t('Cursor, in ~/.cursor/mcp.json')}
        code={`{ "mcpServers": { "jevonganize": { "command": "jevonganize", "args": ["mcp"] } } }`}
      />
    </div>
  );
}

function Appearance() {
  const theme = useWindow((s) => s.theme);
  const density = useWindow((s) => s.density);
  const scale = useWindow((s) => s.scale);
  return (
    <>
      <Field label={t('Theme')} help={t('System follows your OS, and changes when it does.')}>
        <Segmented
          label={t('Theme')}
          value={theme}
          options={[
            { value: 'system', label: t('System') },
            { value: 'light', label: t('Light') },
            { value: 'dark', label: t('Dark') },
          ]}
          onChange={(next) => useWindow.setState({ theme: next as Theme })}
        />
      </Field>
      <Field label={t('Density')}>
        <Select
          label={t('Density')}
          className="w-40"
          value={density}
          options={[
            { value: 'comfortable', label: t('Comfortable') },
            { value: 'compact', label: t('Compact') },
          ]}
          onChange={(d) => useWindow.setState({ density: d as typeof density })}
        />
      </Field>
      <Field label={t('UI scale')} help={t('Kept in this window, not in config.')}>
        <Select
          label={t('UI scale')}
          className="w-40"
          value={String(scale)}
          options={['0.8', '0.9', '1', '1.1', '1.25', '1.5', '1.75'].map((value) => ({
            value,
            label: `${Number(value) * 100}%`,
          }))}
          onChange={(s) => useWindow.setState({ scale: Number(s) })}
        />
      </Field>
    </>
  );
}

function TourStart() {
  return (
    <Field
      label={t('Guided tour')}
      help={t('A short walk through the main screens. It changes nothing.')}
    >
      <Button onClick={startTour}>{t('Start the tour')}</Button>
    </Field>
  );
}

/** The parts of pages that do not come from the schema, by `Section.fixed`. */
export const FIXED: Record<Exclude<Section['fixed'], 'models' | undefined>, () => ReactNode> = {
  keys: Keys,
  libraries: Libraries,
  agents: Agents,
  appearance: Appearance,
  health: Health,
  tour: TourStart,
};
