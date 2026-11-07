import { t } from '../i18n/index.ts';
import { useState } from 'react';
import type { FolderRule } from '../../types.ts';
import type { VfolderTagSuggestions } from '../../tool-map.ts';
import { Button } from '../components/ui/button.tsx';
import { Field, Input, Segmented, Select } from '../components/ui/field.tsx';
import { NoMatchWarning, RuleHints } from './folders-rule-hints.tsx';
import { TagCombobox } from './folders-tag-combobox.tsx';
import type { Editing } from './folders-tree-row.tsx';

/** The parent choice that means "no parent". Real choices are folder ids, as strings. */
export const TOP_LEVEL = 'top';

/** A tag's value as a folder name: `topic:finance/tax` is `finance / tax`. */
const nameFor = (tag: string) =>
  tag
    .slice(tag.indexOf(':') + 1)
    .split('/')
    .join(' / ');

/**
 * The form's fields, from the folder being edited or, for a new one, from its seed. Until the
 * person types a name, a new folder is named after its first tag.
 */
export function useFolderDraft(editing: Editing) {
  const existing = editing.folder;
  const seed = existing?.rule ?? editing.seed;
  const [typedName, setName] = useState(existing?.name);
  const [tags, setTags] = useState(seed?.tags ?? []);
  const [match, setMatch] = useState(seed?.tag_match ?? 'all');
  const [exclude, setExclude] = useState(seed?.exclude_tags ?? []);
  const [parent, setParent] = useState(
    editing.parent === null ? TOP_LEVEL : String(editing.parent),
  );
  const [homeTag, setHomeTag] = useState(existing?.tag ?? '');
  const name = typedName ?? (tags[0] ? nameFor(tags[0]) : '');
  const rule: FolderRule = {
    tags,
    tag_match: match,
    exclude_tags: exclude,
    ...(existing?.rule.folder && { folder: existing.rule.folder }),
  };
  const draft = { name, rule, parent, homeTag };
  const set = { setName, setTags, setMatch, setExclude, setParent, setHomeTag };
  return { draft, set };
}

export type FolderDraft = ReturnType<typeof useFolderDraft>['draft'];

type DraftSetters = ReturnType<typeof useFolderDraft>['set'];

type RuleProps = { draft: FolderDraft; set: DraftSetters; hints?: VfolderTagSuggestions };

/** The folder's rule: the tags it collects, whether any or all must match, and the tags it skips. */
function RuleFields({ draft, set, hints }: RuleProps) {
  const { tags, tag_match, exclude_tags } = draft.rule;
  return (
    <>
      <Field
        label={t('Tags')}
        help={t('Empty collects every file, for a folder that only groups others.')}
      >
        <TagCombobox label={t('Tags')} value={tags} onChange={set.setTags} />
        <RuleHints hints={hints} onAdd={(tag) => set.setTags([...tags, tag])} />
      </Field>
      <Field label={t('Match')}>
        <Segmented
          label={t('Match')}
          value={tag_match}
          onChange={(next) => set.setMatch(next === 'any' ? 'any' : 'all')}
          options={[
            { value: 'all', label: t('All of these tags') },
            { value: 'any', label: t('Any of these tags') },
          ]}
        />
      </Field>
      <Field label={t('Without')}>
        <TagCombobox label={t('Without')} value={exclude_tags} onChange={set.setExclude} negated />
      </Field>
    </>
  );
}

/** Every field of the folder editor, in the order a person fills them. */
export function FolderFields(props: RuleProps & { parents: { value: string; label: string }[] }) {
  const { draft, set, parents } = props;
  const { tags } = draft.rule;
  return (
    <>
      <Field label={t('Name')}>
        <Input
          value={draft.name}
          onChange={(e) => set.setName(e.target.value)}
          aria-label={t('Name')}
        />
      </Field>
      <RuleFields {...props} />
      <Field
        label={t('Inside')}
        help={t('A folder inside another shows only files that match both.')}
      >
        <Select
          label={t('Inside')}
          value={draft.parent}
          onChange={set.setParent}
          options={parents}
        />
      </Field>
      <Field
        label={t('Home tag')}
        help={t('What a file dropped in gets. Left empty, the rule’s tag when it has exactly one.')}
      >
        <Input
          value={draft.homeTag}
          onChange={(e) => set.setHomeTag(e.target.value)}
          aria-label={t('Home tag')}
          className="font-mono text-xs"
          placeholder={tags.length === 1 ? tags[0] : t('Dropping is off')}
        />
      </Field>
    </>
  );
}

/** Delete on the left for a saved folder, then the no-match warning, cancel and save. */
export function FormButtons(props: {
  canDelete: boolean;
  canSave: boolean;
  hints?: VfolderTagSuggestions;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const { canDelete, canSave, hints, onDelete, onCancel } = props;
  return (
    <div className="flex items-center justify-between gap-2 pt-2">
      {canDelete ? (
        <Button variant="danger" onClick={onDelete}>
          {t('Delete folder')}
        </Button>
      ) : (
        <span />
      )}
      <span className="flex items-center gap-1.5">
        <NoMatchWarning hints={hints} />
        <Button variant="ghost" onClick={onCancel}>
          {t('Cancel')}
        </Button>
        <Button variant="primary" type="submit" disabled={!canSave}>
          {t('Save')}
        </Button>
      </span>
    </div>
  );
}
