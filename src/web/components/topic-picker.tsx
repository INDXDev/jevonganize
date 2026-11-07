import { t } from '../i18n/index.ts';
import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useTool } from '../api.ts';
import { formatCount } from '../lib.ts';
import { TagChip } from './tag-chip.tsx';
import { Button } from './ui/button.tsx';
import { Input } from './ui/field.tsx';

/** Everyday catalog domains, offered as a way in before anything is typed. */
const DOMAINS = ['finance', 'work', 'legal', 'health', 'travel', 'housing', 'family', 'hobbies'];

/** The catalog: searching is local and free. Only "Choose for me" sends file names. */
export function TopicPicker(props: {
  topics: string[];
  canChoose: boolean;
  picking: boolean;
  onAdd: (topic: string) => void;
  onRemove: (topic: string) => void;
  onChoose: () => void;
}) {
  const { topics, canChoose, picking, onAdd, onRemove, onChoose } = props;
  const [text, setText] = useState('');
  const searching = text.length > 1;
  const { data: found = [] } = useTool(
    'search_catalog',
    { text: text.toLowerCase(), limit: 30 },
    { enabled: searching },
  );
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          aria-label={t('Search topic catalog')}
          placeholder={t('Search topic catalog')}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <Button className="shrink-0" disabled={!canChoose || picking} onClick={onChoose}>
          <Sparkles /> {picking ? t('Choosing…') : t('Choose for me')}
        </Button>
      </div>
      <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
        {searching
          ? found
              .filter((value) => !topics.includes(value))
              .map((value) => (
                <TagChip key={value} tag={value} sign="+" onClick={() => onAdd(value)} />
              ))
          : DOMAINS.map((domain) => (
              <TagChip key={domain} tag={domain} onClick={() => setText(`${domain}/`)} />
            ))}
      </div>
      {topics.length > 0 ? (
        <>
          <p className="text-xs text-subtle">
            {t('{count} topics chosen', { count: formatCount(topics.length) })}
          </p>
          <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto">
            {topics.map((topic) => (
              <TagChip key={topic} tag={topic} onRemove={() => onRemove(topic)} />
            ))}
          </div>
        </>
      ) : (
        <p className="text-xs text-subtle">
          {t(
            'Pick from 110,000 topics, or leave this to the model: it reads your file names and chooses 100, for about $0.16 at gpt-6-luna prices.',
          )}
        </p>
      )}
    </div>
  );
}
