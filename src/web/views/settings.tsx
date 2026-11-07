import { setLanguage, t } from '../i18n/index.ts';
import { useState } from 'react';
import { call, queryClient, useTool } from '../api.ts';
import { Divider, Pane, Panes } from '../components/pane.tsx';
import { Button } from '../components/ui/button.tsx';
import { keyLabel, useReset } from '../lib.ts';
import { notify, useActions, useView } from '../tabs.ts';
import { AiModels, SendImages } from './settings-ai.tsx';
import { countModelProblems } from './settings-models.ts';
import type { Config, Schema } from './settings-form.tsx';
import { KeyFields } from './settings-keys.tsx';
import { findSection, layout, type Section } from './settings-layout.ts';
import { matchingGroups, SettingsNav } from './settings-nav.tsx';
import { FIXED } from './settings-sections.tsx';

/** The changed keys only, keeping nesting, so `set_config` gets a partial config. */
function diff(before: Config, after: Config): Config {
  const changed: Config = {};
  for (const [key, value] of Object.entries(after)) {
    const old = before[key];
    if (JSON.stringify(old) === JSON.stringify(value)) continue;
    const bothTables = [old, value].every((v) => v && typeof v === 'object' && !Array.isArray(v));
    changed[key] = bothTables ? diff(old as Config, value as Config) : value;
  }
  return changed;
}

/** The config being edited, how it differs from the saved one, and saving it. */
function useConfigDraft() {
  const { data, isLoading, error } = useTool('get_config', {});
  const saved: Config = data?.config ?? {};
  // From the cache when it is warm, as `useReset` only sees later changes.
  const [draft, setDraft] = useState<Config>(saved);
  const [saveError, setSaveError] = useState('');
  useReset(data, () => setDraft(saved));

  const changes = diff(saved, draft);
  const dirty = Object.keys(changes).length > 0;
  const blocked = countModelProblems(draft) > 0;
  const save = async () => {
    setSaveError('');
    try {
      const config = await call('set_config', changes);
      setLanguage(config.language, data?.system_language);
      await queryClient.invalidateQueries({ queryKey: ['get_config'] });
      notify(t('Settings saved'));
    } catch (e) {
      setSaveError((e as Error).message);
    }
  };
  useActions({ save: () => void (dirty && !blocked && save()) });

  const discard = () => setDraft(saved);
  const schema = (data?.schema ?? {}) as Schema;
  return {
    schema,
    isLoading,
    error,
    saved,
    draft,
    setDraft,
    saveError,
    dirty,
    blocked,
    save,
    discard,
  };
}

type ConfigDraft = ReturnType<typeof useConfigDraft>;

function SaveBar(props: { blocked: boolean; onDiscard: () => void; onSave: () => void }) {
  return (
    <div className="flex items-center justify-end gap-2 p-2">
      {props.blocked && (
        <output className="mr-auto text-sm text-destructive">
          {t('Fix the marked fields to save.')}
        </output>
      )}
      <Button variant="ghost" onClick={props.onDiscard}>
        {t('Discard')}
      </Button>
      <Button variant="primary" disabled={props.blocked} onClick={props.onSave}>
        {t('Save')} <span className="font-mono text-2xs opacity-70">{keyLabel('mod+s')}</span>
      </Button>
    </div>
  );
}

/**
 * The field filter for a search. A search that names the page's title matches the whole page, so
 * it filters nothing; otherwise only fields with the word show.
 */
function fieldFilter(section: Section, needle: string): string {
  const pageCopy = `${t(section.title)} ${t(section.description)}`.toLowerCase();
  return needle && !pageCopy.includes(needle) ? needle : '';
}

/** A page's content: the fixed part it has, if any, and then its config keys. */
function SectionBody({
  section,
  form,
  filter,
}: {
  section: Section;
  form: ConfigDraft;
  filter: string;
}) {
  const { draft, setDraft, schema } = form;
  const isModels = section.fixed === 'models';
  const fixedPart = section.fixed;
  const Fixed = fixedPart && fixedPart !== 'models' ? FIXED[fixedPart] : undefined;
  // The tour's controls read best after the fields; every other fixed part goes before them.
  const fixedGoesLast = section.fixed === 'tour';
  return (
    <>
      {isModels && (
        <AiModels
          saved={form.saved}
          draft={draft}
          onChange={setDraft}
          sendImages={
            <SendImages
              value={draft.send_images}
              onChange={(on) => setDraft({ ...draft, send_images: on })}
            />
          }
        />
      )}
      {Fixed && !fixedGoesLast && (
        <div className="mb-4">
          <Fixed />
        </div>
      )}
      <KeyFields
        keys={isModels ? [] : section.keys}
        schema={schema}
        draft={draft}
        filter={filter}
        onChange={setDraft}
      />
      {Fixed && fixedGoesLast && <Fixed />}
    </>
  );
}

/** Settings, grouped by task. Config keys and tools are unchanged; see docs/ui.md#settings. */
export function Settings() {
  const view = useView();
  const form = useConfigDraft();
  const [search, setSearch] = useState('');
  const groups = layout(Object.keys(form.schema.properties ?? {}));
  const needle = search.trim().toLowerCase();
  const section = findSection(groups, view.section);
  const saveBar = form.dirty && (
    <SaveBar blocked={form.blocked} onDiscard={form.discard} onSave={() => void form.save()} />
  );
  return (
    <Panes id="settings" panes={['nav', 'form']}>
      <SettingsNav
        groups={matchingGroups(groups, needle, form.schema)}
        current={section.id}
        search={search}
        onSearch={setSearch}
      />
      <Divider />
      <Pane
        id="form"
        minSize={420}
        loading={form.isLoading}
        error={form.error}
        title={<h2 className="label">{t(section.title)}</h2>}
        footer={saveBar}
      >
        <div className="max-w-3xl p-4">
          <p className="mb-4 text-sm text-muted-foreground">{t(section.description)}</p>
          {form.saveError && (
            <p
              role="alert"
              className="mb-3 rounded-md border border-destructive p-2 text-sm text-destructive"
            >
              {form.saveError}
            </p>
          )}
          <SectionBody section={section} form={form} filter={fieldFilter(section, needle)} />
        </div>
      </Pane>
    </Panes>
  );
}
