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

const closeOverlay = () => useWindow.setState({ overlay: null });

/**
 * Adds or removes `tag`. Several files, or the whole query, change through a plan the inspector
 * shows; one selected file, or else the open one, changes at once.
 */
async function applyTag(tag: string, isRemoving: boolean, query: FileQuery, openFile?: number) {
  const change = isRemoving ? { remove: [tag] } : { add: [tag] };
  const { selection } = useWindow.getState();
  const ids = [...selection.ids];
  const isBulk = selection.all || ids.length > 1;
  if (!isBulk) {
    const fileId = ids[0] ?? openFile;
    if (fileId) await editTags(fileId, change);
    return;
  }
  const scope = selection.all ? { query } : { file_ids: ids };
  const title = isRemoving ? t('Remove {tag}', { tag }) : t('Tag with {tag}', { tag });
  const plan = await act('propose_changes', { ...scope, ...change, title });
  if (plan) useWindow.setState({ planId: plan.id });
}

/** The tag search: existing tags to pick, and, when adding, the typed text as a new one. */
function TagCommand(props: {
  title: string;
  text: string;
  onText: (text: string) => void;
  canCreate: boolean;
  tags?: TagCount[];
  onPick: (tag: string) => void;
}) {
  const { title, text, onText, canCreate, tags, onPick } = props;
  const newTag = text.trim();
  return (
    <Cmdk label={title}>
      <Cmdk.Input
        value={text}
        onValueChange={onText}
        placeholder={t('Tag, such as topic:finance')}
        className="h-10 w-full border-b bg-transparent px-3 font-mono text-md outline-none placeholder:text-subtle"
      />
      <Cmdk.List className="max-h-72 overflow-y-auto p-1">
        {newTag && canCreate && (
          <Cmdk.Item
            value={`__new ${text}`}
            onSelect={() => onPick(newTag)}
            className="flex h-row items-center gap-2 rounded-sm px-2 text-sm data-[selected=true]:bg-soft"
          >
            <Plus className="size-3.5" /> {t('Add “{tag}”', { tag: newTag })}
          </Cmdk.Item>
        )}
        {tags?.map((entry) => (
          <Cmdk.Item
            key={entry.tag}
            value={entry.tag}
            onSelect={() => onPick(entry.tag)}
            className="flex h-row items-center rounded-sm px-2 data-[selected=true]:bg-soft"
          >
            <TagChip tag={entry.tag} count={entry.count} />
          </Cmdk.Item>
        ))}
      </Cmdk.List>
    </Cmdk>
  );
}

/** Adds or removes a tag: on the open file at once, or on a selection as a plan. */
export function TagDialog({ query }: { query: FileQuery }) {
  const overlay = useWindow((s) => s.overlay);
  const isOpen = overlay === 'tag' || overlay === 'untag';
  const isRemoving = overlay === 'untag';
  const title = isRemoving ? t('Remove a tag') : t('Add a tag');
  const { file } = useView();
  const { data: tags } = useTool('list_tags', {}, { enabled: isOpen });
  const [text, setText] = useState('');

  const pick = (tag: string) => {
    closeOverlay();
    setText('');
    void applyTag(tag, isRemoving, query, file);
  };

  return (
    <Dialog open={isOpen} onClose={closeOverlay} title={title} bare>
      <TagCommand
        title={title}
        text={text}
        onText={setText}
        canCreate={!isRemoving}
        tags={tags}
        onPick={pick}
      />
    </Dialog>
  );
}

/** The large preview of the open file. Space closes it. */
export function QuickPreview({ id }: { id?: number }) {
  const isOpen = useWindow((s) => s.overlay === 'preview');
  const { data: file } = useTool('get_file', { id }, { enabled: isOpen && !!id });
  return (
    <Dialog
      open={isOpen && !!file}
      onClose={closeOverlay}
      onKeyDown={(e) => e.key === ' ' && closeOverlay()}
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
