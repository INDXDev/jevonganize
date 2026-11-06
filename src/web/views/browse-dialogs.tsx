import { t } from '../i18n/index.ts';
import { Command as Cmdk } from 'cmdk';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import type { FileQuery, TagCount } from '../../types.ts';
import { act, editTags, useTool } from '../api.ts';
import { Preview } from '../components/preview/index.tsx';
import { TagChip } from '../components/tag-chip.tsx';
import { Dialog } from '../components/ui/dialog.tsx';
import { useView, useWindow } from '../tabs.ts';

const close = () => useWindow.setState({ overlay: null });

/** Changes the selection through a plan, or the one file at once. */
async function applyTag(tag: string, removing: boolean, query: FileQuery, file?: number) {
  const change = removing ? { remove: [tag] } : { add: [tag] };
  const { selection } = useWindow.getState();
  const ids = [...selection.ids];
  if (selection.all || ids.length > 1) {
    const scope = selection.all ? { query } : { file_ids: ids };
    const plan = await act('propose_changes', {
      ...scope,
      ...change,
      title: removing ? t('Remove {tag}', { tag }) : t('Tag with {tag}', { tag }),
    });
    if (plan) useWindow.setState({ planId: plan.id });
    return;
  }
  const id = ids[0] ?? file;
  if (id) await editTags(id, change);
}

function TagCommand(props: {
  title: string;
  text: string;
  onText: (text: string) => void;
  canCreate: boolean;
  tags?: TagCount[];
  onPick: (tag: string) => void;
}) {
  const { title, text, onText, canCreate, tags, onPick } = props;
  const typed = text.trim();
  return (
    <Cmdk label={title}>
      <Cmdk.Input
        value={text}
        onValueChange={onText}
        placeholder={t('Tag, such as topic:finance')}
        className="h-10 w-full border-b bg-transparent px-3 font-mono text-md outline-none placeholder:text-subtle"
      />
      <Cmdk.List className="max-h-72 overflow-y-auto p-1">
        {typed && canCreate && (
          <Cmdk.Item
            value={`__new ${text}`}
            onSelect={() => onPick(typed)}
            className="flex h-row items-center gap-2 rounded-sm px-2 text-sm data-[selected=true]:bg-soft"
          >
            <Plus className="size-3.5" /> {t('Add “{tag}”', { tag: typed })}
          </Cmdk.Item>
        )}
        {tags?.map((tagItem) => (
          <Cmdk.Item
            key={tagItem.tag}
            value={tagItem.tag}
            onSelect={() => onPick(tagItem.tag)}
            className="flex h-row items-center rounded-sm px-2 data-[selected=true]:bg-soft"
          >
            <TagChip tag={tagItem.tag} count={tagItem.count} />
          </Cmdk.Item>
        ))}
      </Cmdk.List>
    </Cmdk>
  );
}

/** Adds or removes a tag: on the open file at once, or on a selection as a plan. */
export function TagDialog({ query }: { query: FileQuery }) {
  const overlay = useWindow((s) => s.overlay);
  const open = overlay === 'tag' || overlay === 'untag';
  const removing = overlay === 'untag';
  const title = removing ? t('Remove a tag') : t('Add a tag');
  const { file } = useView();
  const { data: tags } = useTool('list_tags', {}, { enabled: open });
  const [text, setText] = useState('');

  const pick = (tag: string) => {
    close();
    setText('');
    void applyTag(tag, removing, query, file);
  };

  return (
    <Dialog open={open} onClose={close} title={title} bare>
      <TagCommand
        title={title}
        text={text}
        onText={setText}
        canCreate={!removing}
        tags={tags}
        onPick={pick}
      />
    </Dialog>
  );
}

/** The large preview of the open file. Space closes it. */
export function QuickPreview({ id }: { id?: number }) {
  const open = useWindow((s) => s.overlay === 'preview');
  const { data: file } = useTool('get_file', { id }, { enabled: open && !!id });
  return (
    <Dialog
      open={open && !!file}
      onClose={close}
      onKeyDown={(e) => e.key === ' ' && close()}
      title={file?.name ?? t('Preview')}
      className="top-[6vh] h-[86vh] max-h-none w-[62rem] max-w-[92vw]"
    >
      {file && (
        <div className="min-h-0 flex-1">
          <Preview file={file} large />
        </div>
      )}
    </Dialog>
  );
}
