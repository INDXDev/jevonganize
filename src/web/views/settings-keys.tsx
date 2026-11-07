import { t } from '../i18n/index.ts';
import { Fields, JsonControl, type Config, type Schema } from './settings-form.tsx';
import { TABLE_COPY } from './settings-layout.ts';

const isTable = (s: Schema) =>
  s.type === 'object' || (s.type === 'array' && s.items?.type === 'object');

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

/** A stretch of a page's keys: one table, or a run of scalar keys that share a form. */
type KeyRun = { table?: string; scalars: string[] };

/** Splits a page's keys, in order, into tables and runs of scalars between them. */
function keyRuns(keys: string[], schema: Schema): KeyRun[] {
  const runs: KeyRun[] = [];
  for (const key of keys) {
    const field = schema.properties?.[key];
    if (!field) continue;
    const last = runs.at(-1);
    if (isTable(field)) runs.push({ table: key, scalars: [] });
    else if (last && !last.table) last.scalars.push(key);
    else runs.push({ scalars: [key] });
  }
  return runs;
}

type KeyFieldsProps = {
  keys: string[];
  schema: Schema;
  draft: Config;
  filter: string;
  onChange: (draft: Config) => void;
};

/** A table under its own heading, with its copy from `TABLE_COPY` when it has some. */
function TableRun(props: Omit<KeyFieldsProps, 'keys'> & { table: string }) {
  const { table, schema, draft, filter, onChange } = props;
  const copy = TABLE_COPY[table];
  return (
    <section className="mb-4">
      {copy && (
        <>
          <h3 className="label mb-0.5">{t(copy.title)}</h3>
          <p className="mb-1 text-xs text-subtle">{t(copy.description)}</p>
        </>
      )}
      <TableSection
        name={table}
        schema={schema.properties![table]!}
        value={draft[table]}
        filter={filter}
        onChange={(value) => onChange({ ...draft, [table]: value })}
      />
    </section>
  );
}

/** The config keys of a page: runs of scalars as one form, each table under its own heading. */
export function KeyFields(props: KeyFieldsProps) {
  const { keys, schema, draft, filter, onChange } = props;
  return keyRuns(keys, schema).map((run) => {
    if (run.table) return <TableRun key={run.table} {...props} table={run.table} />;
    const properties = Object.fromEntries(run.scalars.map((k) => [k, schema.properties![k]!]));
    return (
      <div key={run.scalars.join()} className="mb-4">
        <Fields schema={{ properties }} value={draft} filter={filter} onChange={onChange} />
      </div>
    );
  });
}
