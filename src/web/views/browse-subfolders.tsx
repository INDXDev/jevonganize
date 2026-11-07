import { t } from '../i18n/index.ts';
import { Folder } from 'lucide-react';
import { useTool, useViewOptions } from '../api.ts';
import { formatCount } from '../lib.ts';
import { setView } from '../tabs.ts';

/** The folders directly under the open one, which is how a person walks down a library. */
export function Subfolders({ folder }: { folder?: string }) {
  const { show_dotfiles } = useViewOptions();
  const { data: subfolders = [] } = useTool(
    'list_folders',
    { folder: folder ?? '' },
    { enabled: !!folder },
  );
  const isShown = (name: string) => show_dotfiles || !name.startsWith('.');
  const shown = folder ? subfolders.filter((sub) => isShown(sub.name)) : [];
  if (!shown.length) return null;
  return (
    <nav
      aria-label={t('Subfolders')}
      className="flex max-h-16 flex-wrap gap-1 overflow-y-auto border-b bg-surface-1 px-3 py-1.5"
    >
      {shown.map((sub) => (
        <button
          key={sub.path}
          type="button"
          title={sub.path}
          onClick={() => setView({ folder: sub.path, file: null })}
          className="flex h-6 max-w-56 items-center gap-1.5 rounded-sm border px-1.5 text-sm hover:bg-surface-2"
        >
          <Folder aria-hidden className="size-3.5 shrink-0 text-subtle" />
          <span className="min-w-0 truncate">{sub.name}</span>
          <span className="font-mono text-xs text-subtle">{formatCount(sub.files)}</span>
        </button>
      ))}
    </nav>
  );
}
