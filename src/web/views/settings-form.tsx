import { t } from '../i18n/index.ts';
import { useState } from 'react';
import { ChipInput, Field, Input, Select, Switch, Textarea } from '../components/ui/field.tsx';
import { useReset } from '../lib.ts';
import { description, help, optionTitle, title } from './settings-copy.ts';

/** The part of JSON Schema that `get_config` uses. */
export type Schema = {
  type?: string;
  enum?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  minimum?: number;
  maximum?: number;
  description?: string;
};

/** A whole or partial config, as `get_config` and `set_config` carry it. */
export type Config = Record<string, unknown>;

/** One control, chosen by schema type. See the table in docs/ui.md. */
function Control(props: {
  name: string;
  schema: Schema;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const { name, schema, value, onChange } = props;
  const { type } = schema;
  if (name === 'language')
    return (
      <Select
        label={title(name)}
        className="w-48"
        value={value as string}
        options={[
          { value: 'system', label: t('System default') },
          { value: 'en', label: 'English' },
          { value: 'ja', label: '日本語' },
          { value: 'zh-CN', label: '简体中文' },
        ]}
        onChange={onChange}
      />
    );
  if (type === 'boolean')
    return <Switch aria-label={title(name)} checked={!!value} onCheckedChange={onChange} />;
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
        label={title(name)}
        className="w-48"
        value={value as string}
        options={schema.enum.map((v) => ({ value: v, label: optionTitle(v) }))}
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
    return <ChipInput label={title(name)} value={(value as string[]) ?? []} onChange={onChange} />;
  return <JsonControl name={name} value={value} onChange={onChange} />;
}

const asJson = (value: unknown) => JSON.stringify(value, null, 2) ?? '';

/** Anything without a form of its own, such as `pipeline`, edited as JSON and checked on save. */
// shortcut: `set_config` merges tables, so a profile deleted here stays. Add a delete to it if needed.
export function JsonControl(props: {
  name: string;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const { name, value, onChange } = props;
  const [text, setText] = useState(() => asJson(value));
  const [typed, setTyped] = useState(value);
  const [bad, setBad] = useState(false);
  // Only a change from outside, such as Discard, rewrites the text under the cursor.
  useReset(value, () => {
    if (value !== typed) {
      setText(asJson(value));
      setBad(false);
    }
  });
  const edit = (next: string) => {
    setText(next);
    try {
      const parsed: unknown = JSON.parse(next);
      setTyped(parsed);
      setBad(false);
      onChange(parsed);
    } catch {
      setBad(true);
    }
  };
  return (
    <>
      <Textarea
        aria-label={title(name)}
        spellCheck={false}
        rows={Math.min(24, text.split('\n').length + 1)}
        className="w-full font-mono text-xs"
        value={text}
        onChange={(e) => edit(e.target.value)}
      />
      {bad && <p className="pt-1 text-xs text-destructive">{t('Not valid JSON yet.')}</p>}
    </>
  );
}

/** The fields of one schema object, narrowed by a lowercase filter. */
export function Fields(props: {
  schema: Schema;
  value: Config;
  filter: string;
  onChange: (value: Config) => void;
}) {
  const { schema, value, filter, onChange } = props;
  return Object.entries(schema.properties ?? {})
    .filter(([key, field]) =>
      `${key} ${title(key)} ${field.description ?? ''} ${description(field.description) ?? ''}`
        .toLowerCase()
        .includes(filter),
    )
    .map(([key, field]) => (
      <Field key={key} label={title(key)} help={help(key, field.description)}>
        <Control
          name={key}
          schema={field}
          value={value[key]}
          onChange={(next) => onChange({ ...value, [key]: next })}
        />
      </Field>
    ));
}
