import { setLanguage, t } from '../i18n/index.ts';
import { useState } from 'react';
import { call, queryClient, useTool } from '../api.ts';
import { Divider, Pane, Panes } from '../components/pane.tsx';
import { Button } from '../components/ui/button.tsx';
import { Input } from '../components/ui/field.tsx';
import { cn, keyLabel, useReset } from '../lib.ts';
import { notify, setView, useActions, useView } from '../tabs.ts';
import { Fields, JsonControl, type Config, type Schema } from './settings-form.tsx';
import { title } from './settings-copy.ts';
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

/** Splits the schema into the scalars under General and the tables with a section each. */
function splitSchema(schema: Schema) {
  const entries = Object.entries(schema.properties ?? {});
  return {
    scalars: { properties: Object.fromEntries(entries.filter(([, s]) => !isTable(s))) },
    tables: entries.filter(([, s]) => isTable(s)),
  };
}

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
  useActions({ save: () => void (dirty && save()) });

  const discard = () => setDraft(saved);
  const schema = (data?.schema ?? {}) as Schema;
  return { schema, isLoading, error, draft, setDraft, problem, dirty, save, discard };
}

function NavItem({ id, section }: { id: string; section: string }) {
  return (
    <button
      type="button"
      aria-current={id === section ? 'page' : undefined}
      onClick={() => setView({ section: id })}
      className={cn(
        'flex h-row w-full items-center rounded-sm px-2 text-left text-sm text-muted-foreground hover:bg-surface-2 hover:text-foreground',
        id === section && 'bg-soft text-foreground',
      )}
    >
      {title(id)}
    </button>
  );
}

function SettingsNav({ section, sections }: { section: string; sections: string[] }) {
  return (
    <Pane
      id="nav"
      title={t('Settings')}
      defaultSize="18%"
      minSize={170}
      maxSize="30%"
      className="p-1.5"
    >
      {sections.map((id) => (
        <NavItem key={id} id={id} section={section} />
      ))}
      <div className="my-1.5 border-t" />
      {Object.keys(FIXED).map((id) => (
        <NavItem key={id} id={id} section={section} />
      ))}
    </Pane>
  );
}

function FilterInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <Input
      aria-label={t('Filter settings')}
      placeholder={t('Filter…')}
      className="h-6 w-44 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function SaveBar({ onDiscard, onSave }: { onDiscard: () => void; onSave: () => void }) {
  return (
    <div className="flex items-center justify-end gap-2 p-2">
      <Button variant="ghost" onClick={onDiscard}>
        {t('Discard')}
      </Button>
      <Button variant="primary" onClick={onSave}>
        {' '}
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

/** Settings, generated from the JSON Schema `get_config` returns, plus five fixed sections. */
export function Settings() {
  const { section = 'general' } = useView();
  const form = useConfigDraft();
  const { draft, setDraft, problem } = form;
  const [filter, setFilter] = useState('');

  const { scalars, tables } = splitSchema(form.schema);
  const needle = filter.trim().toLowerCase();
  const Fixed = FIXED[section];
  const table = tables.find(([key]) => key === section);

  return (
    <Panes id="settings" panes={['nav', 'form']}>
      <SettingsNav section={section} sections={['general', ...tables.map(([key]) => key)]} />
      <Divider />
      <Pane
        id="form"
        minSize={420}
        loading={form.isLoading}
        error={form.error}
        title={<h2 className="label">{title(section)}</h2>}
        actions={!Fixed && <FilterInput value={filter} onChange={setFilter} />}
        footer={
          !Fixed &&
          form.dirty && <SaveBar onDiscard={form.discard} onSave={() => void form.save()} />
        }
      >
        <div className="max-w-3xl p-4">
          {problem && (
            <p
              role="alert"
              className="mb-3 rounded-md border border-destructive p-2 text-sm text-destructive"
            >
              {problem}
            </p>
          )}
          {Fixed && <Fixed />}
          {section === 'general' && (
            <Fields schema={scalars} value={draft} filter={needle} onChange={setDraft} />
          )}
          {table && (
            <TableSection
              name={section}
              schema={table[1]}
              value={draft[section]}
              filter={needle}
              onChange={(value) => setDraft({ ...draft, [section]: value })}
            />
          )}
        </div>
      </Pane>
    </Panes>
  );
}
