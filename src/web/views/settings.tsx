import { setLanguage, t } from '../i18n/index.ts';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { call, queryClient, useTool } from '../api.ts';
import { Divider, Pane, Panes } from '../components/pane.tsx';
import { Button } from '../components/ui/button.tsx';
import { Input } from '../components/ui/field.tsx';
import { cn, keyLabel, useReset } from '../lib.ts';
import { notify, setView, useActions, useView } from '../tabs.ts';
import { AiModels, modelErrors, SendImages } from './settings-ai.tsx';
import { Fields, JsonControl, type Config, type Schema } from './settings-form.tsx';
import { description, title } from './settings-copy.ts';
import {
  findSection,
  layout,
  TABLE_COPY,
  type Section,
  type SectionGroup,
} from './settings-layout.ts';
import { FIXED } from './settings-sections.tsx';

/** The changed keys only, keeping nesting, so `set_config` gets a partial config. */
function diff(before: Config, after: Config): Config {
  const changed: Config = {};
  for (const [key, value] of Object.entries(after)) {
    const old = before[key];
    if (JSON.stringify(old) === JSON.stringify(value)) continue;
    const nested = [old, value].every((v) => v && typeof v === 'object' && !Array.isArray(v));
    changed[key] = nested ? diff(old as Config, value as Config) : value;
  }
  return changed;
}

const isTable = (s: Schema) =>
  s.type === 'object' || (s.type === 'array' && s.items?.type === 'object');

/** The config being edited, how it differs from the saved one, and saving it. */
function useConfigDraft() {
  const { data, isLoading, error } = useTool('get_config', {});
  const saved: Config = data?.config ?? {};
  // From the cache when it is warm, as `useReset` only sees later changes.
  const [draft, setDraft] = useState<Config>(saved);
  const [problem, setProblem] = useState('');
  useReset(data, () => setDraft(saved));

  const changes = diff(saved, draft);
  const dirty = Object.keys(changes).length > 0;
  const blocked = modelErrors(draft) > 0;
  const save = async () => {
    setProblem('');
    try {
      const config = await call('set_config', changes);
      setLanguage(config.language, data?.system_language);
      await queryClient.invalidateQueries({ queryKey: ['get_config'] });
      notify(t('Settings saved'));
    } catch (e) {
      setProblem((e as Error).message);
    }
  };
  useActions({ save: () => void (dirty && !blocked && save()) });

  const discard = () => setDraft(saved);
  const schema = (data?.schema ?? {}) as Schema;
  return {
    schema,
    isLoading,
    error,
    saved,
    draft,
    setDraft,
    problem,
    dirty,
    blocked,
    save,
    discard,
  };
}

/** Every word a search can match on a page: its own copy and that of each field on it. */
function searchText(section: Section, schema: Schema): string {
  const words: string[] = [t(section.title), t(section.description), section.title];
  for (const key of section.keys) {
    const field = schema.properties?.[key];
    words.push(key, title(key), TABLE_COPY[key] ? t(TABLE_COPY[key].title) : '');
    for (const [inner, sub] of Object.entries(field?.properties ?? {}))
      words.push(inner, title(inner), description(sub.description) ?? '');
  }
  if (section.fixed === 'models')
    words.push(
      t('Decision model'),
      t('Chat model'),
      t('Name-reading model'),
      t('AI service'),
      'provider chat ner',
    );
  return words.join(' ').toLowerCase();
}

function SettingsNav(props: {
  groups: SectionGroup[];
  current: string;
  search: string;
  onSearch: (value: string) => void;
}) {
  const { groups, current, search, onSearch } = props;
  return (
    <Pane
      id="nav"
      title={t('Settings')}
      defaultSize="20%"
      minSize={190}
      maxSize="32%"
      className="p-1.5"
    >
      <div className="relative mb-2">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-subtle"
        />
        <Input
          type="search"
          aria-label={t('Search settings')}
          placeholder={t('Search settings')}
          className="h-6 pl-6 text-sm"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>
      {groups.map((group) =>
        group.sections.length ? (
          <section key={group.id} aria-label={t(group.title)} className="mb-2">
            <h3 className="label px-2 pb-0.5">{t(group.title)}</h3>
            {group.sections.map((section) => (
              <button
                key={section.id}
                type="button"
                aria-current={section.id === current ? 'page' : undefined}
                onClick={() => setView({ section: section.id })}
                className={cn(
                  'flex h-row w-full items-center rounded-sm px-2 text-left text-sm text-muted-foreground hover:bg-surface-2 hover:text-foreground',
                  section.id === current && 'bg-soft text-foreground',
                )}
              >
                {t(section.title)}
              </button>
            ))}
          </section>
        ) : null,
      )}
      {groups.every((g) => !g.sections.length) && (
        <p className="px-2 text-sm text-subtle">{t('No setting matches.')}</p>
      )}
    </Pane>
  );
}

function SaveBar(props: { blocked: boolean; onDiscard: () => void; onSave: () => void }) {
  return (
    <div className="flex items-center justify-end gap-2 p-2">
      {props.blocked && (
        <output className="mr-auto text-sm text-destructive">
          {t('Fix the marked fields to save.')}
        </output>
      )}
      <Button variant="ghost" onClick={props.onDiscard}>
        {t('Discard')}
      </Button>
      <Button variant="primary" disabled={props.blocked} onClick={props.onSave}>
        {t('Save')} <span className="font-mono text-2xs opacity-70">{keyLabel('mod+s')}</span>
      </Button>
    </div>
  );
}

/** One table of the config: a form when its schema has properties, JSON otherwise. */
function TableSection(props: {
  name: string;
  schema: Schema;
  value: unknown;
  filter: string;
  onChange: (value: unknown) => void;
}) {
  const { name, schema, value, filter, onChange } = props;
  if (!schema.properties)
    return <JsonControl key={name} name={name} value={value} onChange={onChange} />;
  if (schema.type !== 'object') return null;
  return (
    <Fields schema={schema} value={(value ?? {}) as Config} filter={filter} onChange={onChange} />
  );
}

/** The config keys of a page: runs of scalars as one form, each table under its own heading. */
function KeyFields(props: {
  keys: string[];
  schema: Schema;
  draft: Config;
  filter: string;
  onChange: (draft: Config) => void;
}) {
  const { keys, schema, draft, filter, onChange } = props;
  const present = keys.filter((key) => schema.properties?.[key]);
  const runs: { table?: string; scalars: string[] }[] = [];
  for (const key of present) {
    if (isTable(schema.properties![key]!)) runs.push({ table: key, scalars: [] });
    else if (runs.at(-1) && !runs.at(-1)!.table) runs.at(-1)!.scalars.push(key);
    else runs.push({ scalars: [key] });
  }
  return runs.map((run) => {
    if (!run.table) {
      const properties = Object.fromEntries(run.scalars.map((k) => [k, schema.properties![k]!]));
      return (
        <div key={run.scalars.join()} className="mb-4">
          <Fields schema={{ properties }} value={draft} filter={filter} onChange={onChange} />
        </div>
      );
    }
    const key = run.table;
    const copy = TABLE_COPY[key];
    return (
      <section key={key} className="mb-4">
        {copy && (
          <>
            <h3 className="label mb-0.5">{t(copy.title)}</h3>
            <p className="mb-1 text-xs text-subtle">{t(copy.description)}</p>
          </>
        )}
        <TableSection
          name={key}
          schema={schema.properties![key]!}
          value={draft[key]}
          filter={filter}
          onChange={(value) => onChange({ ...draft, [key]: value })}
        />
      </section>
    );
  });
}

/** Settings, grouped by task. Config keys and tools are unchanged; see docs/ui.md#settings. */
export function Settings() {
  const view = useView();
  const form = useConfigDraft();
  const { draft, setDraft, problem, schema } = form;
  const [search, setSearch] = useState('');

  const groups = layout(Object.keys(schema.properties ?? {}));
  const needle = search.trim().toLowerCase();
  const shown = needle
    ? groups.map((g) => ({
        ...g,
        sections: g.sections.filter((s) => searchText(s, schema).includes(needle)),
      }))
    : groups;
  const section = findSection(groups, view.section);
  // A search that names the page's title matches the whole page, not only fields with that word.
  const filter =
    needle && !`${t(section.title)} ${t(section.description)}`.toLowerCase().includes(needle)
      ? needle
      : '';
  const Fixed = section.fixed && section.fixed !== 'models' ? FIXED[section.fixed] : undefined;
  const keys = section.fixed === 'models' ? [] : section.keys;

  return (
    <Panes id="settings" panes={['nav', 'form']}>
      <SettingsNav groups={shown} current={section.id} search={search} onSearch={setSearch} />
      <Divider />
      <Pane
        id="form"
        minSize={420}
        loading={form.isLoading}
        error={form.error}
        title={<h2 className="label">{t(section.title)}</h2>}
        footer={
          form.dirty && (
            <SaveBar
              blocked={form.blocked}
              onDiscard={form.discard}
              onSave={() => void form.save()}
            />
          )
        }
      >
        <div className="max-w-3xl p-4">
          <p className="mb-4 text-sm text-muted-foreground">{t(section.description)}</p>
          {problem && (
            <p
              role="alert"
              className="mb-3 rounded-md border border-destructive p-2 text-sm text-destructive"
            >
              {problem}
            </p>
          )}
          {section.fixed === 'models' && (
            <AiModels
              saved={form.saved}
              draft={draft}
              onChange={setDraft}
              sendImages={
                <SendImages
                  value={draft.send_images}
                  onChange={(on) => setDraft({ ...draft, send_images: on })}
                />
              }
            />
          )}
          {Fixed && section.fixed !== 'tour' && (
            <div className="mb-4">
              <Fixed />
            </div>
          )}
          <KeyFields
            keys={keys}
            schema={schema}
            draft={draft}
            filter={filter}
            onChange={setDraft}
          />
          {Fixed && section.fixed === 'tour' && <Fixed />}
        </div>
      </Pane>
    </Panes>
  );
}
