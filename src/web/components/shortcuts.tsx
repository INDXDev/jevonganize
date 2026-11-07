import { t } from '../i18n/index.ts';
import { commands } from '../commands.ts';
import { keyLabel } from '../lib.ts';
import { useWindow } from '../tabs.ts';
import { Dialog } from './ui/dialog.tsx';

/** Tab 1 stands for the nine "go to tab" commands, which would only repeat it. */
const isLaterTabCommand = (id: string) => /^tab-[2-9]/.test(id);

/** The sheet of every key binding, grouped as the command table groups them. */
export function Shortcuts() {
  const open = useWindow((s) => s.overlay === 'shortcuts');
  const bound = commands.filter((command) => command.keys && !isLaterTabCommand(command.id));
  const groups = Map.groupBy(bound, (command) => command.group);
  return (
    <Dialog
      open={open}
      onClose={() => useWindow.setState({ overlay: null })}
      title={t('Keyboard shortcuts')}
      className="w-[50rem] max-w-[92vw]"
    >
      <div className="columns-2 gap-6 overflow-y-auto p-3">
        {[...groups].map(([group, groupCommands]) => (
          <section key={group} className="mb-3 break-inside-avoid">
            <h3 className="label mb-1">{t(group)}</h3>
            {groupCommands.map((command) => (
              <div
                key={command.id}
                className="flex h-dense items-center justify-between gap-3 text-sm"
              >
                <span className="truncate text-muted-foreground">{command.title}</span>
                <span className="kbd">{keyLabel(command.keys!)}</span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </Dialog>
  );
}
