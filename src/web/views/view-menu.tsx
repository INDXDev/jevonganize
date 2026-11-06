import { t } from '../i18n/index.ts';
import { SlidersHorizontal } from 'lucide-react';
import { Popover } from 'radix-ui';
import { useState, type ReactNode } from 'react';
import type { ViewOptions } from '../../core/config.ts';
import { previewView, saveView, useViewOptions } from '../api.ts';
import { Button } from '../components/ui/button.tsx';
import { Checkbox, Segmented, Slider, Switch } from '../components/ui/field.tsx';
import { keyLabel } from '../lib.ts';
import { useActions } from '../tabs.ts';

const COLUMNS = [
  ['tags', 'Tags'],
  ['kind', 'Kind'],
  ['size', 'Size'],
  ['modified', 'Modified'],
  ['path', 'Folder'],
] as const;

const INFO = [
  { value: 'tags', label: 'Tags' },
  { value: 'kind', label: 'Kind' },
  { value: 'size', label: 'Size' },
  { value: 'modified', label: 'Date' },
  { value: 'none', label: 'None' },
] as const;

type NumberKey = 'thumbnail_size' | 'grid_columns' | 'grid_spacing' | 'text_size';
type BooleanKey = 'show_dotfiles' | 'include_subfolders' | 'show_extensions' | 'list_thumbnails';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-6 items-center justify-between gap-3 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function Range(props: {
  label: string;
  name: NumberKey;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  format?: (value: number) => string;
}) {
  const { label, name, format = (value) => `${value}px`, ...range } = props;
  const value = useViewOptions()[name];
  return (
    <Row label={label}>
      <span className="flex w-40 items-center gap-2">
        <Slider
          {...range}
          label={label}
          value={value}
          onChange={(next) => previewView({ [name]: next })}
          onCommit={(next) => saveView({ [name]: next })}
        />
        <span className="w-10 shrink-0 text-right font-mono text-xs text-subtle">
          {format(value)}
        </span>
      </span>
    </Row>
  );
}

function Toggle({ label, name }: { label: string; name: BooleanKey }) {
  const checked = useViewOptions()[name];
  return (
    <Row label={label}>
      <Switch
        aria-label={label}
        checked={checked}
        onCheckedChange={(next) => saveView({ [name]: next })}
      />
    </Row>
  );
}

function GridOptions() {
  const { grid_columns, thumbnail_fit, grid_info } = useViewOptions();
  return (
    <>
      <Range
        label={t('Per row')}
        name="grid_columns"
        min={0}
        max={12}
        format={(value) => (value ? String(value) : t('Auto'))}
      />
      <Range
        label={t('Thumbnail size')}
        name="thumbnail_size"
        min={64}
        max={512}
        step={8}
        disabled={grid_columns > 0}
      />
      <Range label={t('Spacing')} name="grid_spacing" min={0} max={48} step={2} />
      <Row label={t('Thumbnails')}>
        <Segmented
          label={t('Thumbnails')}
          value={thumbnail_fit}
          options={[
            { value: 'cover', label: t('Fill') },
            { value: 'contain', label: t('Whole') },
          ]}
          onChange={(fit) => saveView({ thumbnail_fit: fit as ViewOptions['thumbnail_fit'] })}
        />
      </Row>
      <Row label={t('Under the name')}>
        <Segmented
          label={t('Under the name')}
          value={grid_info}
          options={INFO.map((option) => ({ ...option, label: t(option.label) }))}
          onChange={(info) => saveView({ grid_info: info as ViewOptions['grid_info'] })}
        />
      </Row>
    </>
  );
}

function ListOptions() {
  const { list_columns } = useViewOptions();
  const set = (column: (typeof COLUMNS)[number][0], on: boolean) => {
    // In the table's order, so columns do not move with the order they were switched on.
    const next = COLUMNS.map(([id]) => id).filter((id) =>
      id === column ? on : list_columns.includes(id),
    );
    saveView({ list_columns: next });
  };
  return (
    <>
      <Toggle label={t('Thumbnails')} name="list_thumbnails" />
      <fieldset className="space-y-1">
        <legend className="pb-1 text-sm text-muted-foreground">{t('Columns')}</legend>
        <div className="grid grid-cols-3 gap-1">
          {COLUMNS.map(([id, label]) => (
            // oxlint-disable-next-line jsx-a11y/label-has-associated-control -- wraps the Radix control
            <label key={id} className="flex items-center gap-1.5 text-sm">
              <Checkbox
                checked={list_columns.includes(id)}
                onCheckedChange={(on) => set(id, on === true)}
              />
              {t(label)}
            </label>
          ))}
        </div>
      </fieldset>
    </>
  );
}

/** Finder's View Options: everything here is the `[view]` config, so Settings shows it too. */
export function ViewMenu({ mode }: { mode: 'grid' | 'list' }) {
  const [open, setOpen] = useState(false);
  useActions({ viewOptions: () => setOpen((now) => !now) });
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          variant="ghost"
          icon
          className="size-6"
          aria-label={t('View options')}
          title={t('View options ({shortcut})', { shortcut: keyLabel('mod+j') })}
        >
          <SlidersHorizontal />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 w-[23rem] space-y-1.5 rounded-md border border-strong bg-popover p-3 shadow-overlay"
        >
          {mode === 'grid' ? <GridOptions /> : <ListOptions />}
          <Range label={t('Text size')} name="text_size" min={10} max={20} />
          <div className="my-2 border-t" />
          <Toggle label={t('Hidden files (dotfiles)')} name="show_dotfiles" />
          <Toggle label={t('Include subfolders')} name="include_subfolders" />
          <Toggle label={t('File extensions')} name="show_extensions" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
