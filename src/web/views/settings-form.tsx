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

type ControlProps = {
  name: string;
  schema: Schema;
  value: unknown;
  onChange: (value: unknown) => void;
};

/** Each language under its own name, so a person can find theirs whatever the current one. */
function LanguageSelect({ name, value, onChange }: ControlProps) {
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
}

/** A number within the schema's bounds. Emptied, the key drops out of the config. */
function NumberInput({ schema, value, onChange }: ControlProps) {
  const isInteger = schema.type === 'integer';
  return (
    <Input
      type="number"
      className="w-28 font-mono"
      min={schema.minimum}
      max={schema.maximum}
      step={isInteger ? 1 : 'any'}
      value={(value as number | undefined) ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
    />
  );
}

/** One control, chosen by schema type. See the table in docs/ui.md. */
function Control(props: ControlProps) {
  const { name, schema, value, onChange } = props;
  const { type } = schema;
  if (name === 'language') return <LanguageSelect {...props} />;
  if (type === 'boolean')
    return <Switch aria-label={title(name)} checked={!!value} onCheckedChange={onChange} />;
  if (type === 'integer' || type === 'number') return <NumberInput {...props} />;
  if (schema.enum)
    return (
      <Select
        label={title(name)}
        className="w-48"
        value={value as string}
        options={schema.enum.map((option) => ({ value: option, label: optionTitle(option) }))}
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
  // The last value this box parsed, to tell its own edits from changes made elsewhere.
  const [lastParsed, setLastParsed] = useState(value);
  const [isInvalid, setIsInvalid] = useState(false);
  // Only a change from outside, such as Discard, rewrites the text under the cursor.
  useReset(value, () => {
    if (value === lastParsed) return;
    setText(asJson(value));
    setIsInvalid(false);
  });
  const edit = (next: string) => {
    setText(next);
    try {
      const parsed: unknown = JSON.parse(next);
      setLastParsed(parsed);
      setIsInvalid(false);
      onChange(parsed);
    } catch {
      setIsInvalid(true);
    }
  };
  const rows = Math.min(24, text.split('\n').length + 1);
  return (
    <>
      <Textarea
        aria-label={title(name)}
        spellCheck={false}
        rows={rows}
        className="w-full font-mono text-xs"
        value={text}
        onChange={(e) => edit(e.target.value)}
      />
      {isInvalid && <p className="pt-1 text-xs text-destructive">{t('Not valid JSON yet.')}</p>}
    </>
  );
}

/** What a filter matches on for one field: its key, its title and its help, in both languages. */
const fieldText = (key: string, field: Schema) =>
  `${key} ${title(key)} ${field.description ?? ''} ${description(field.description) ?? ''}`.toLowerCase();

/** The fields of one schema object, narrowed by a lowercase filter. */
export function Fields(props: {
  schema: Schema;
  value: Config;
  filter: string;
  onChange: (value: Config) => void;
}) {
  const { schema, value, filter, onChange } = props;
  return Object.entries(schema.properties ?? {})
    .filter(([key, field]) => fieldText(key, field).includes(filter))
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
