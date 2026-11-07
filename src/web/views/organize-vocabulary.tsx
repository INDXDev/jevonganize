import { t } from '../i18n/index.ts';
import { useState } from 'react';
import { act, addTopics, chooseTopics, useTool } from '../api.ts';
import { TopicPicker } from '../components/topic-picker.tsx';
import { Field } from '../components/ui/field.tsx';

const setTopic = (value: string, state: 'active' | 'retired') =>
  void act('set_vocabulary', { facet: 'topic', value, state });

/** The values of `topic`, here so they sit next to the run they shape. Retiring keeps a value out of later picks. */
export function TopicsField(props: { folder?: string; canChoose: boolean }) {
  const { folder, canChoose } = props;
  const { data: entries = [] } = useTool('list_vocabulary', { facet: 'topic' });
  const [picking, setPicking] = useState(false);
  const topics = entries.filter((e) => e.state === 'active').map((e) => e.value);
  const choose = async () => {
    setPicking(true);
    await addTopics(await chooseTopics(folder)).finally(() => setPicking(false));
  };
  return (
    <Field
      label={t('Topics')}
      help={t('Topics apply to every folder. Changing them asks topic again on the next run.')}
    >
      <TopicPicker
        topics={topics}
        canChoose={canChoose}
        picking={picking}
        onAdd={(value) => setTopic(value, 'active')}
        onRemove={(value) => setTopic(value, 'retired')}
        onChoose={() => void choose()}
      />
    </Field>
  );
}
