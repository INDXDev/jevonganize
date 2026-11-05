import { Check, ChevronDown, X } from 'lucide-react';
import { Checkbox as RCheckbox, Select as RSelect, Switch as RSwitch } from 'radix-ui';
import { useState, type ComponentProps, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../../lib.ts';

const control =
  'h-control w-full rounded-md border border-control bg-surface-2 px-2 text-md text-foreground placeholder:text-subtle disabled:opacity-50';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(control, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(control, 'h-auto resize-y py-1', className)} {...props} />;
}

export function Checkbox({ className, ...props }: ComponentProps<typeof RCheckbox.Root>) {
  return (
    <RCheckbox.Root
      className={cn(
        'grid size-3.5 shrink-0 place-items-center rounded-sm border border-control data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground',
        className,
      )}
      {...props}
    >
      <RCheckbox.Indicator>
        <Check className="size-3" strokeWidth={3} />
      </RCheckbox.Indicator>
    </RCheckbox.Root>
  );
}

export function Switch({ className, ...props }: ComponentProps<typeof RSwitch.Root>) {
  return (
    <RSwitch.Root
      className={cn(
        'h-4 w-7 shrink-0 rounded-full border border-control bg-surface-2 p-px data-[state=checked]:border-primary data-[state=checked]:bg-primary',
        className,
      )}
      {...props}
    >
      <RSwitch.Thumb className="block size-3 rounded-full bg-muted-foreground transition-transform duration-(--dur-fast) data-[state=checked]:translate-x-3 data-[state=checked]:bg-primary-foreground" />
    </RSwitch.Root>
  );
}

type SelectProps = {
  value?: string;
  onChange: (value: string) => void;
  options: { value: string; label?: string }[];
  label: string;
  className?: string;
  placeholder?: string;
};

export function Select({ value, onChange, options, label, className, placeholder }: SelectProps) {
  return (
    <RSelect.Root value={value} onValueChange={onChange}>
      <RSelect.Trigger
        aria-label={label}
        className={cn(control, 'flex items-center justify-between gap-1 text-left', className)}
      >
        <RSelect.Value placeholder={placeholder} />
        <RSelect.Icon>
          <ChevronDown className="size-3 text-subtle" />
        </RSelect.Icon>
      </RSelect.Trigger>
      <RSelect.Portal>
        <RSelect.Content
          position="popper"
          sideOffset={4}
          className="z-50 min-w-(--radix-select-trigger-width) rounded-md border border-strong bg-popover p-1 shadow-overlay"
        >
          <RSelect.Viewport>
            {options.map((o) => (
              <RSelect.Item
                key={o.value}
                value={o.value}
                className="flex h-dense items-center justify-between gap-3 rounded-sm px-2 text-sm outline-none data-[highlighted]:bg-soft"
              >
                <RSelect.ItemText>{o.label ?? o.value}</RSelect.ItemText>
                <RSelect.ItemIndicator>
                  <Check className="size-3" />
                </RSelect.ItemIndicator>
              </RSelect.Item>
            ))}
          </RSelect.Viewport>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  );
}

/** A list of short strings, edited as chips. Enter or comma adds, Backspace removes the last. */
export function ChipInput(props: {
  value: string[];
  onChange: (value: string[]) => void;
  label: string;
}) {
  const { value, onChange, label } = props;
  const [draft, setDraft] = useState('');
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'Enter' || e.key === ',') && draft.trim()) {
      e.preventDefault();
      onChange([...new Set([...value, draft.trim()])]);
      setDraft('');
    } else if (e.key === 'Backspace' && !draft) onChange(value.slice(0, -1));
  };
  return (
    <div className="flex min-h-control flex-wrap items-center gap-1 rounded-md border border-control bg-surface-2 px-1 py-0.5 focus-within:outline-2 focus-within:outline-ring">
      {value.map((v) => (
        <span
          key={v}
          className="inline-flex items-center gap-0.5 rounded-sm bg-surface-3 pl-1.5 font-mono text-xs"
        >
          {v}
          <button
            type="button"
            aria-label={`Remove ${v}`}
            className="px-0.5 text-subtle hover:text-foreground"
            onClick={() => onChange(value.filter((x) => x !== v))}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        aria-label={label}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        className="min-w-16 flex-1 bg-transparent px-1 text-sm outline-none"
      />
    </div>
  );
}

/** A labelled form row, with help text under the control. */
export function Field(props: { label: string; help?: ReactNode; children: ReactNode }) {
  return (
    <label className="grid grid-cols-[11rem_minmax(0,1fr)] items-start gap-x-3 py-1">
      <span className="pt-1 text-sm text-muted-foreground">{props.label}</span>
      <span className="min-w-0">
        {props.children}
        {props.help && <span className="mt-0.5 block text-xs text-subtle">{props.help}</span>}
      </span>
    </label>
  );
}
