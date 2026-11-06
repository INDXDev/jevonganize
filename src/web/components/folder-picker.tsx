import { t } from '../i18n/index.ts';
import { ArrowUp, Folder } from 'lucide-react';
import { useState } from 'react';
import { useTool } from '../api.ts';
import { shortPath } from '../lib.ts';
import { Button } from './ui/button.tsx';
import { Dialog } from './ui/dialog.tsx';

/** Browses directories on the machine, through `browse_dirs`. */
export function FolderPicker(props: {
  open: boolean;
  onClose: () => void;
  onPick: (path: string) => void;
}) {
  const { open, onClose, onPick } = props;
  const [path, setPath] = useState<string>();
  const { data, error } = useTool('browse_dirs', { path }, { enabled: open });
  return (
    <Dialog open={open} onClose={onClose} title={t('Choose a folder')}>
      <div className="flex items-center gap-2 border-b px-2 py-1.5">
        <Button
          variant="ghost"
          icon
          aria-label={t('Parent folder')}
          disabled={!data?.parent}
          onClick={() => setPath(data?.parent ?? undefined)}
        >
          <ArrowUp />
        </Button>
        <span className="min-w-0 flex-1 truncate font-mono text-xs">
          {data && shortPath(data.path)}
        </span>
        <Button variant="primary" disabled={!data} onClick={() => data && onPick(data.path)}>
          {t('Use this folder')}
        </Button>
      </div>
      <div className="min-h-48 overflow-y-auto p-1">
        {error && <p className="p-2 text-sm text-destructive">{error.message}</p>}
        {data?.dirs.map((dir) => (
          <button
            key={dir}
            type="button"
            onClick={() => setPath(`${data.path}/${dir}`)}
            className="flex h-row w-full items-center gap-2 rounded-sm px-2 text-sm hover:bg-surface-3"
          >
            <Folder className="size-3.5 text-subtle" /> {dir}
          </button>
        ))}
        {data && !data.dirs.length && (
          <p className="p-2 text-sm text-subtle">{t('No subfolders.')}</p>
        )}
      </div>
    </Dialog>
  );
}
