import { t } from '../i18n/index.ts';
import { useState } from 'react';
import { Button } from '../components/ui/button.tsx';
import { Input } from '../components/ui/field.tsx';
import { ModelFields } from './settings-ai-fields.tsx';
import { modelOf } from './settings-models.ts';

/** The names `profile` can use: letters, digits, `_` and `-`. */
const PROFILE_NAME = /^[a-z0-9_-]+$/i;

/** The name input and Add button for a new profile. */
function NewProfile(props: { onAdd: (name: string) => void; isTaken: (name: string) => boolean }) {
  const { onAdd, isTaken } = props;
  const [name, setName] = useState('');
  const isValid = PROFILE_NAME.test(name) && !isTaken(name);
  const add = () => {
    onAdd(name);
    setName('');
  };
  return (
    <div className="flex max-w-96 gap-2">
      <Input
        aria-label={t('New profile name')}
        placeholder={t('Name, such as vision')}
        className="font-mono"
        value={name}
        onChange={(e) => setName(e.target.value.trim())}
      />
      <Button disabled={!isValid} onClick={add}>
        {t('Add')}
      </Button>
    </div>
  );
}

/** Named extra decision models, which a question set picks with `profile`. */
export function Profiles(props: {
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
}) {
  const { value: profiles, onChange } = props;
  return (
    <section className="mb-4">
      <h3 className="label mb-1">{t('Extra models for some questions')}</h3>
      <p className="mb-2 text-xs text-subtle">
        {t(
          'Optional. A question set uses one by naming it in profile. Each one used costs another request per file. To remove one, edit config.toml.',
        )}
      </p>
      {Object.entries(profiles).map(([name, table]) => (
        <div key={name} className="mb-2 rounded-md border p-3">
          <h4 className="mb-1 font-mono text-sm">{name}</h4>
          <ModelFields
            modelRole="decision"
            value={modelOf(table)}
            onChange={(next) => onChange({ ...profiles, [name]: next })}
          />
        </div>
      ))}
      <NewProfile
        isTaken={(name) => Object.hasOwn(profiles, name)}
        onAdd={(name) => onChange({ ...profiles, [name]: { name: 'openai' } })}
      />
    </section>
  );
}
