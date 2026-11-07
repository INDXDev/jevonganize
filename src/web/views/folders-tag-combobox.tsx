/** Picking tags for a folder's rule: existing tags as you type, with their counts, or new text. */
import { t } from '../i18n/index.ts';
import { Command as Cmdk } from 'cmdk';
import { Plus } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { TagCount } from '../../types.ts';
import { useTool } from '../api.ts';
import { TagChip } from '../components/tag-chip.tsx';
import { cn } from '../lib.ts';

/** How many existing tags the list offers at once. */
const MATCHES_SHOWN = 8;

/** The cmdk value of the row that takes the typed text as it is. */
const NEW_VALUE = '__new';

/** The part after `facet:`, where a person usually starts typing. */
const valueOf = (tag: string) => tag.slice(tag.indexOf(':') + 1);

/**
 * The tags that hold `text`, leaving out `taken`: those that start with it, in the tag or its
 * value, come first, then those that merely contain it. Each keeps the order `list_tags` gave.
 */
export function tagMatches(tags: TagCount[], text: string, taken: string[]): TagCount[] {
  const needle = text.toLowerCase();
  const open = tags.filter(({ tag }) => !taken.includes(tag));
  const starts = (tag: string) =>
    tag.toLowerCase().startsWith(needle) || valueOf(tag).toLowerCase().startsWith(needle);
  const prefixed = open.filter(({ tag }) => starts(tag));
  const containing = open.filter(({ tag }) => !starts(tag) && tag.toLowerCase().includes(needle));
  return [...prefixed, ...containing].slice(0, MATCHES_SHOWN);
}

type SearchProps = {
  label: string;
  /** Tags already chosen, which the list leaves out. */
  taken: string[];
  onPick: (tag: string) => void;
  /** Backspace in the empty field, which takes back the last chip. */
  onBackspace?: () => void;
  /** Takes focus when it appears, for a field opened by a button. */
  focusOnMount?: boolean;
  className?: string;
};

/** The typed text's row, for a tag no file carries yet. */
function NewTagItem({ text, onPick }: { text: string; onPick: (tag: string) => void }) {
  return (
    <Cmdk.Item
      value={NEW_VALUE}
      onSelect={() => onPick(text)}
      className="flex h-row items-center gap-2 rounded-sm px-2 text-sm data-[selected=true]:bg-soft"
    >
      <Plus className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate font-mono text-xs">{text}</span>
      <span className="font-mono text-xs text-subtle">{t('{count} files', { count: 0 })}</span>
    </Cmdk.Item>
  );
}

/**
 * The search's state: the typed text, its matches, and the highlighted row, which moves to the
 * best match as the text changes.
 */
function useTagSearch(taken: string[]) {
  const [text, setText] = useState('');
  const [active, setActive] = useState('');
  const { data: tags = [] } = useTool('list_tags', {});
  const typed = text.trim();
  const matches = typed ? tagMatches(tags, typed, taken) : [];
  const isNew = !!typed && !taken.includes(typed) && !tags.some(({ tag }) => tag === typed);
  const type = (next: string) => {
    setText(next);
    const best = next.trim() ? tagMatches(tags, next.trim(), taken)[0] : undefined;
    setActive(best?.tag ?? NEW_VALUE);
  };
  return { text, typed, matches, isNew, active, setActive, type };
}

/** The rows under the field: matching tags with their counts, then the typed text if it is new. */
function MatchList(props: {
  matches: TagCount[];
  newTag: string | null;
  onPick: (tag: string) => void;
}) {
  const { matches, newTag, onPick } = props;
  return (
    // Keeps focus in the field on a click, so a picker that closes on blur sees the pick.
    <Cmdk.List
      onMouseDown={(e) => e.preventDefault()}
      className="absolute top-full left-0 z-20 mt-1 max-h-64 w-72 max-w-[80vw] overflow-y-auto rounded-md border border-strong bg-popover p-1 shadow-overlay"
    >
      {matches.map((entry) => (
        <Cmdk.Item
          key={entry.tag}
          value={entry.tag}
          onSelect={() => onPick(entry.tag)}
          className="flex h-row items-center rounded-sm px-2 data-[selected=true]:bg-soft"
        >
          <TagChip tag={entry.tag} count={entry.count} />
        </Cmdk.Item>
      ))}
      {newTag && <NewTagItem text={newTag} onPick={onPick} />}
    </Cmdk.List>
  );
}

/**
 * A field that offers existing tags as you type. Enter or a click takes the highlighted one, which
 * starts on the best match; text that is no tag yet can be taken too.
 */
export function TagSearch(props: SearchProps) {
  const { label, taken, onPick, onBackspace, focusOnMount, className } = props;
  const search = useTagSearch(taken);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusOnMount) input.current?.focus();
  }, [focusOnMount]);
  const pick = (tag: string) => {
    onPick(tag);
    search.type('');
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Backspace' && !search.text) onBackspace?.();
  };
  const hasRows = search.matches.length > 0 || search.isNew;
  return (
    <Cmdk
      label={label}
      shouldFilter={false}
      value={search.active}
      onValueChange={search.setActive}
      className={cn('relative min-w-24 flex-1', className)}
    >
      <Cmdk.Input
        ref={input}
        value={search.text}
        onValueChange={search.type}
        onKeyDown={onKeyDown}
        placeholder={t('Tag, such as topic:finance')}
        className="h-6 w-full bg-transparent px-1 font-mono text-xs outline-none placeholder:text-subtle"
      />
      {hasRows && (
        <MatchList
          matches={search.matches}
          newTag={search.isNew ? search.typed : null}
          onPick={pick}
        />
      )}
    </Cmdk>
  );
}

/** A list of tags as chips, with a `TagSearch` that adds to it. `negated` marks excluded tags. */
export function TagCombobox(props: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  negated?: boolean;
}) {
  const { label, value, onChange, negated } = props;
  return (
    <div className="flex min-h-control flex-wrap items-center gap-1 rounded-md border border-control bg-surface-2 px-1 py-0.5 focus-within:outline-2 focus-within:outline-ring">
      {value.map((tag) => (
        <TagChip
          key={tag}
          tag={tag}
          negated={negated}
          onRemove={() => onChange(value.filter((other) => other !== tag))}
        />
      ))}
      <TagSearch
        label={label}
        taken={value}
        onPick={(tag) => onChange([...value, tag])}
        onBackspace={() => onChange(value.slice(0, -1))}
      />
    </div>
  );
}
