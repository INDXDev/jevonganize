/** How the settings screen groups config keys by task. Keys keep their names; only the layout is here. */
import type { PlainMessage } from '../i18n/index.ts';

/** A page in the settings nav. `keys` are top-level config keys shown on it, in order. */
export type Section = {
  id: string;
  title: PlainMessage;
  description: PlainMessage;
  keys: string[];
  /** A page with its own component, before any `keys`. */
  fixed?: 'models' | 'keys' | 'libraries' | 'appearance' | 'agents' | 'health' | 'tour';
};

/** A heading in the nav, over its pages. */
export type SectionGroup = { id: string; title: PlainMessage; sections: Section[] };

/** A heading and a sentence over a config table on its page. */
export const TABLE_COPY: Record<string, { title: PlainMessage; description: PlainMessage }> = {
  watch: {
    title: 'Watch for changes',
    description: 'Keeps the index up to date while the app is open.',
  },
  facets: {
    title: 'Question sets',
    description:
      'Packs or single questions to ask about each file. The Facets screen lists them with their labels.',
  },
  thresholds: {
    title: 'How sure the model must be',
    description:
      'Confidence decides whether a tag is applied, sent to Review, or dropped. Changing these costs nothing.',
  },
  tag_colors: {
    title: 'Tag colors',
    description:
      'Easier to change on the Tags screen. Colours stay in the app and are not written to files.',
  },
};

/** Every page, by group. A key that is in none of them lands in "Other", so new keys still show. */
export const GROUPS: SectionGroup[] = [
  {
    id: 'basics',
    title: 'Basics',
    sections: [
      {
        id: 'general',
        title: 'Language and help',
        description: 'The language of the app, and the guided tour.',
        keys: ['language'],
        fixed: 'tour',
      },
      {
        id: 'folders',
        title: 'Folders',
        description: 'The folders Jevonganize indexes, what it skips, and how it notices changes.',
        keys: ['exclude', 'watch'],
        fixed: 'libraries',
      },
      {
        id: 'appearance',
        title: 'Appearance',
        description: 'Theme, density and size of this window.',
        keys: [],
        fixed: 'appearance',
      },
    ],
  },
  {
    id: 'ai',
    title: 'AI',
    sections: [
      {
        id: 'models',
        title: 'AI models',
        description: 'Which model decides tags, which one chats, and which one reads names.',
        keys: ['provider', 'chat', 'ner', 'profiles', 'send_images'],
        fixed: 'models',
      },
      {
        id: 'keys',
        title: 'API keys',
        description: 'Keys for each provider. They stay on this machine and are never shown again.',
        keys: [],
        fixed: 'keys',
      },
    ],
  },
  {
    id: 'tags',
    title: 'Tags and questions',
    sections: [
      {
        id: 'tagging',
        title: 'Tagging rules',
        description:
          'Which questions are asked, how sure the model must be, and how many tags a file gets.',
        keys: ['facets', 'thresholds', 'max_tags', 'fiscal_year_start', 'tag_colors'],
      },
    ],
  },
  {
    id: 'advanced',
    title: 'Advanced',
    sections: [
      {
        id: 'display',
        title: 'File list',
        description: 'Thumbnails, columns and hidden files in the file list.',
        keys: ['view'],
      },
      {
        id: 'limits',
        title: 'What is read per file',
        description: 'How much text, how many pages and images are read and sent for each file.',
        keys: ['budget'],
      },
      {
        id: 'pipeline',
        title: 'Extraction pipeline',
        description: 'Which readers run for which kinds of file. For experts.',
        keys: ['pipeline'],
      },
      {
        id: 'performance',
        title: 'Server and speed',
        description: 'The local port, and how many model calls run at once.',
        keys: ['port', 'concurrency'],
      },
      {
        id: 'agents',
        title: 'Agents',
        description: 'Connect an AI client such as Claude Code through MCP.',
        keys: [],
        fixed: 'agents',
      },
      {
        id: 'health',
        title: 'Health',
        description:
          'Checks the key, each folder and optional tools, and shows where files are kept.',
        keys: [],
        fixed: 'health',
      },
    ],
  },
];

const OTHER: Section = {
  id: 'other',
  title: 'Other',
  description: 'Settings without a page of their own yet.',
  keys: [],
};

/** Old section ids, from links made before the grouping, mapped to the page that holds them now. */
const ALIASES: Record<string, string> = {
  libraries: 'folders',
  watch: 'folders',
  provider: 'models',
  profiles: 'models',
  chat: 'models',
  ner: 'models',
  facets: 'tagging',
  thresholds: 'tagging',
  tag_colors: 'tagging',
  view: 'display',
  budget: 'limits',
};

/** The groups for a schema, with any key no page names added to an "Other" page. */
export function layout(schemaKeys: string[]): SectionGroup[] {
  const placed = new Set(GROUPS.flatMap((g) => g.sections.flatMap((s) => s.keys)));
  const rest = schemaKeys.filter((key) => !placed.has(key));
  if (!rest.length) return GROUPS;
  return GROUPS.map((group) =>
    group.id === 'advanced'
      ? { ...group, sections: [...group.sections, { ...OTHER, keys: rest }] }
      : group,
  );
}

/** The page for a `section` query value, following old ids. Unknown ids open the first page. */
export function findSection(groups: SectionGroup[], id: string | undefined): Section {
  const all = groups.flatMap((g) => g.sections);
  const wanted = id && Object.hasOwn(ALIASES, id) ? ALIASES[id] : id;
  return all.find((s) => s.id === wanted) ?? all[0]!;
}
