import { t } from '../i18n/index.ts';
import { Search } from 'lucide-react';
import { Pane } from '../components/pane.tsx';
import { Input } from '../components/ui/field.tsx';
import { cn } from '../lib.ts';
import { setView } from '../tabs.ts';
import { description, title } from './settings-copy.ts';
import type { Schema } from './settings-form.tsx';
import { TABLE_COPY, type Section, type SectionGroup } from './settings-layout.ts';

/** Words a search for the AI models page should find, though no config key on it holds them. */
const MODEL_PAGE_WORDS = [
  'Decision model',
  'Chat model',
  'Name-reading model',
  'AI service',
] as const;

/** Every word a search can match on a page: its own copy and that of each field on it. */
function searchText(section: Section, schema: Schema): string {
  const words: string[] = [t(section.title), t(section.description), section.title];
  for (const key of section.keys) {
    const field = schema.properties?.[key];
    const tableTitle = TABLE_COPY[key] ? t(TABLE_COPY[key].title) : '';
    words.push(key, title(key), tableTitle);
    for (const [inner, sub] of Object.entries(field?.properties ?? {}))
      words.push(inner, title(inner), description(sub.description) ?? '');
  }
  if (section.fixed === 'models')
    words.push(...MODEL_PAGE_WORDS.map((word) => t(word)), 'provider chat ner');
  return words.join(' ').toLowerCase();
}

/** The groups with only the pages that match `needle`, or every page when it is empty. */
export function matchingGroups(groups: SectionGroup[], needle: string, schema: Schema) {
  if (!needle) return groups;
  return groups.map((group) => ({
    ...group,
    sections: group.sections.filter((section) => searchText(section, schema).includes(needle)),
  }));
}

function NavGroup({ group, current }: { group: SectionGroup; current: string }) {
  return (
    <section aria-label={t(group.title)} className="mb-2">
      <h3 className="label px-2 pb-0.5">{t(group.title)}</h3>
      {group.sections.map((section) => {
        const isCurrent = section.id === current;
        return (
          <button
            key={section.id}
            type="button"
            aria-current={isCurrent ? 'page' : undefined}
            onClick={() => setView({ section: section.id })}
            className={cn(
              'flex h-row w-full items-center rounded-sm px-2 text-left text-sm text-muted-foreground hover:bg-surface-2 hover:text-foreground',
              isCurrent && 'bg-soft text-foreground',
            )}
          >
            {t(section.title)}
          </button>
        );
      })}
    </section>
  );
}

/** The page list, with the search box that narrows it. */
export function SettingsNav(props: {
  groups: SectionGroup[];
  current: string;
  search: string;
  onSearch: (value: string) => void;
}) {
  const { groups, current, search, onSearch } = props;
  const nonEmptyGroups = groups.filter((group) => group.sections.length > 0);
  return (
    <Pane
      id="nav"
      title={t('Settings')}
      defaultSize="20%"
      minSize={190}
      maxSize="32%"
      className="p-1.5"
    >
      <div className="relative mb-2">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-subtle"
        />
        <Input
          type="search"
          aria-label={t('Search settings')}
          placeholder={t('Search settings')}
          className="h-6 pl-6 text-sm"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>
      {nonEmptyGroups.map((group) => (
        <NavGroup key={group.id} group={group} current={current} />
      ))}
      {nonEmptyGroups.length === 0 && (
        <p className="px-2 text-sm text-subtle">{t('No setting matches.')}</p>
      )}
    </Pane>
  );
}
