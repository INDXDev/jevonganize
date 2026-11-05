import { Copy, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { act, call, queryClient, useTool } from '../api.ts';
import { FolderPicker } from '../components/folder-picker.tsx';
import { Divider, Pane, Panes } from '../components/pane.tsx';
import { Button } from '../components/ui/button.tsx';
import { ChipInput, Field, Input, Select, Switch } from '../components/ui/field.tsx';
import { cn, formatCount, keyLabel, shortPath, useReset } from '../lib.ts';
import { notify, setView, useActions, useView, useWindow } from '../tabs.ts';
import type { ProviderName } from '../../types.ts';

type Schema = {
  type?: string;
  enum?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  minimum?: number;
  maximum?: number;
  description?: string;
};
type Config = Record<string, unknown>;

const title = (key: string) => {
  const words = key.replaceAll('_', ' ');
  return words[0]!.toUpperCase() + words.slice(1);
};

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

/** One control, chosen by schema type. See the table in docs/ui.md. */
function Control(props: {
  name: string;
  schema: Schema;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const { name, schema, value, onChange } = props;
  const { type } = schema;
  if (type === 'boolean')
    return <Switch aria-label={name} checked={!!value} onCheckedChange={onChange} />;
  if (type === 'integer' || type === 'number')
    return (
      <Input
        type="number"
        className="w-28 font-mono"
        min={schema.minimum}
        max={schema.maximum}
        step={type === 'integer' ? 1 : 'any'}
        value={(value as number | undefined) ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      />
    );
  if (schema.enum)
    return (
      <Select
        label={name}
        className="w-48"
        value={value as string}
        options={schema.enum.map((v) => ({ value: v }))}
        onChange={onChange}
      />
    );
  if (type === 'string')
    return (
      <Input
        className="max-w-80"
        value={(value as string | undefined) ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
      />
    );
  if (type === 'array' && schema.items?.type === 'string')
    return <ChipInput label={name} value={(value as string[]) ?? []} onChange={onChange} />;
  return <p className="pt-1 text-xs text-subtle">Edit in the config file.</p>;
}

function Fields(props: {
  schema: Schema;
  value: Config;
  filter: string;
  onChange: (value: Config) => void;
}) {
  const { schema, value, filter, onChange } = props;
  return Object.entries(schema.properties ?? {})
    .filter(([key, s]) => `${key} ${s.description ?? ''}`.toLowerCase().includes(filter))
    .map(([key, s]) => (
      <Field key={key} label={title(key)} help={s.description}>
        <Control
          name={key}
          schema={s}
          value={value[key]}
          onChange={(next) => onChange({ ...value, [key]: next })}
        />
      </Field>
    ));
}

const PROVIDERS: ProviderName[] = ['openai', 'typesafe', 'gateway', 'cloudflare', 'openrouter'];

function Keys() {
  const { data: status } = useTool('status', {});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const replace = async (provider: ProviderName) => {
    await act('set_api_key', { provider, key: drafts[provider] ?? '' });
    setDrafts({ ...drafts, [provider]: '' });
    notify(`Key saved for ${provider}`);
  };
  return (
    <>
      {PROVIDERS.map((provider) => {
        return (
          <Field
            key={provider}
            label={provider}
            help={status?.keys.includes(provider) ? 'Key present' : 'No key'}
          >
            <span className="flex max-w-96 gap-2">
              <Input
                type="password"
                autoComplete="off"
                aria-label={`${provider} key`}
                placeholder="Replace key"
                value={drafts[provider] ?? ''}
                onChange={(e) => setDrafts({ ...drafts, [provider]: e.target.value })}
              />
              <Button disabled={!drafts[provider]} onClick={() => void replace(provider)}>
                Replace
              </Button>
            </span>
          </Field>
        );
      })}
    </>
  );
}

function Libraries() {
  const { data = [] } = useTool('list_libraries', {});
  const [picking, setPicking] = useState(false);
  return (
    <>
      <ul className="max-w-xl divide-y rounded-md border">
        {data.map((l) => (
          <li key={l.path} className="flex items-center gap-3 px-2.5 py-1.5">
            <span className="min-w-0 flex-1 truncate font-mono text-xs">{shortPath(l.path)}</span>
            <span className="font-mono text-xs text-subtle">{formatCount(l.files)} files</span>
            <Button
              variant="ghost"
              icon
              aria-label={`Remove ${l.path}`}
              title="Clears the index only. Tags stay."
              onClick={() => void act('remove_library', { path: l.path })}
            >
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
      <Button className="mt-2" onClick={() => setPicking(true)}>
        Add a folder
      </Button>
      <p className="mt-1 text-xs text-subtle">Removing clears the index only. Tags stay.</p>
      <FolderPicker
        open={picking}
        onClose={() => setPicking(false)}
        onPick={(path) => {
          setPicking(false);
          void act('add_library', { path });
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
          aria-label={`Copy ${label}`}
          onClick={() => void navigator.clipboard.writeText(code).then(() => notify('Copied'))}
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
        Your client's model sees names, paths and tags. Plans it proposes wait in Review for you.
      </p>
      <Snippet label="Claude Code" code="claude mcp add jevonganize -- jevonganize mcp" />
      <Snippet
        label="Cursor, in ~/.cursor/mcp.json"
        code={`{ "mcpServers": { "jevonganize": { "command": "jevonganize", "args": ["mcp"] } } }`}
      />
    </div>
  );
}

function Appearance() {
  const density = useWindow((s) => s.density);
  const scale = useWindow((s) => s.scale);
  return (
    <>
      <Field label="Density">
        <Select
          label="Density"
          className="w-40"
          value={density}
          options={[{ value: 'comfortable' }, { value: 'compact' }]}
          onChange={(d) => useWindow.setState({ density: d as typeof density })}
        />
      </Field>
      <Field label="UI scale" help="Kept in this window, not in config.">
        <Select
          label="UI scale"
          className="w-40"
          value={String(scale)}
          options={['0.9', '1', '1.1', '1.25'].map((value) => ({
            value,
            label: `${Number(value) * 100}%`,
          }))}
          onChange={(s) => useWindow.setState({ scale: Number(s) })}
        />
      </Field>
    </>
  );
}

const FIXED: Record<string, () => ReactNode> = {
  keys: Keys,
  libraries: Libraries,
  agents: Agents,
  appearance: Appearance,
};

/** Settings, generated from the JSON Schema `get_config` returns, plus four fixed sections. */
export function Settings() {
  const { section = 'general' } = useView();
  const { data, isLoading, error } = useTool('get_config', {});
  const [draft, setDraft] = useState<Config>({});
  const [filter, setFilter] = useState('');
  const [problem, setProblem] = useState('');
  useReset(data, () => setDraft(data?.config ?? {}));

  const schema = (data?.schema ?? {}) as Schema;
  const entries = Object.entries(schema.properties ?? {});
  const isTable = (s: Schema) =>
    s.type === 'object' || (s.type === 'array' && s.items?.type === 'object');
  const scalars = { properties: Object.fromEntries(entries.filter(([, s]) => !isTable(s))) };
  const tables = entries.filter(([, s]) => isTable(s));

  const changes = diff(data?.config ?? {}, draft);
  const dirty = Object.keys(changes).length > 0;
  const save = async () => {
    setProblem('');
    try {
      await call('set_config', changes);
      await queryClient.invalidateQueries({ queryKey: ['get_config'] });
      notify('Settings saved');
    } catch (e) {
      setProblem((e as Error).message);
    }
  };
  useActions({ save: () => void (dirty && save()) });

  const needle = filter.trim().toLowerCase();
  const sections = ['general', ...tables.map(([key]) => key)];
  const fixed = Object.keys(FIXED);
  const Fixed = FIXED[section];
  const table = tables.find(([key]) => key === section);
  const nav = (id: string) => (
    <button
      key={id}
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

  return (
    <Panes id="settings" panes={['nav', 'form']}>
      <Pane
        id="nav"
        title="Settings"
        defaultSize="18%"
        minSize={170}
        maxSize="30%"
        className="p-1.5"
      >
        {sections.map(nav)}
        <div className="my-1.5 border-t" />
        {fixed.map(nav)}
      </Pane>
      <Divider />
      <Pane
        id="form"
        minSize={420}
        loading={isLoading}
        error={error}
        title={<h2 className="label">{title(section)}</h2>}
        actions={
          !Fixed && (
            <Input
              aria-label="Filter settings"
              placeholder="Filter…"
              className="h-6 w-44 text-sm"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          )
        }
        footer={
          !Fixed &&
          dirty && (
            <div className="flex items-center justify-end gap-2 p-2">
              <Button variant="ghost" onClick={() => setDraft(data?.config ?? {})}>
                Discard
              </Button>
              <Button variant="primary" onClick={() => void save()}>
                Save <span className="font-mono text-2xs opacity-70">{keyLabel('mod+s')}</span>
              </Button>
            </div>
          )
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
          {table && table[1].type === 'object' && table[1].properties && (
            <Fields
              schema={table[1]}
              value={(draft[section] ?? {}) as Config}
              filter={needle}
              onChange={(value) => setDraft({ ...draft, [section]: value })}
            />
          )}
          {table && !table[1].properties && (
            <p className="text-sm text-subtle">Edit in the config file.</p>
          )}
        </div>
      </Pane>
    </Panes>
  );
}
