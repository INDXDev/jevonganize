/** Human-readable labels for the schema's stable config keys. */
import { t } from '../i18n/index.ts';

const labels = {
  language: 'Language',
  general: 'General',
  port: 'Port',
  concurrency: 'Concurrency',
  max_tags: 'Maximum tags',
  fiscal_year_start: 'Fiscal year start',
  exclude: 'Exclusions',
  send_images: 'Send images',
  tag_colors: 'Tag colors',
  view: 'View',
  provider: 'Provider',
  profiles: 'Profiles',
  chat: 'Chat',
  facets: 'Facets',
  thresholds: 'Thresholds',
  budget: 'Budget',
  pipeline: 'Pipeline',
  watch: 'Watch',
  keys: 'API keys',
  libraries: 'Libraries',
  agents: 'Agents',
  appearance: 'Appearance',
  health: 'Health',
  name: 'Name',
  model: 'Model',
  base_url: 'Base URL',
  account_id: 'Account ID',
  enabled: 'Enabled',
  disabled: 'Disabled',
  apply: 'Apply threshold',
  review: 'Review threshold',
  estimated_to_review: 'Review estimated answers',
  text_chars: 'Text characters',
  pdf_pages: 'PDF pages',
  render_pages: 'Rendered pages',
  thin_text_chars: 'Thin text characters',
  images: 'Images per file',
  image_edge: 'Image edge',
  sheets: 'Sheets',
  sheet_rows: 'Sheet rows',
  zip_entries: 'Archive entries',
  max_parse_mb: 'Maximum parse size (MB)',
  max_office_mb: 'Maximum Office size (MB)',
  timeout_seconds: 'Timeout (seconds)',
  walk_minutes: 'Walk interval (minutes)',
  show_dotfiles: 'Hidden files (dotfiles)',
  include_subfolders: 'Include subfolders',
  show_extensions: 'File extensions',
  thumbnail_size: 'Thumbnail size',
  grid_columns: 'Grid columns',
  grid_spacing: 'Grid spacing',
  thumbnail_fit: 'Thumbnail fit',
  grid_info: 'Grid information',
  text_size: 'Text size',
  list_columns: 'List columns',
  list_thumbnails: 'List thumbnails',
} as const;

/** A translated schema label; future keys retain a readable fallback. */
export function title(key: string): string {
  if (Object.hasOwn(labels, key)) return t(labels[key as keyof typeof labels]);
  const words = key.replaceAll('_', ' ');
  return (words[0]?.toUpperCase() ?? '') + words.slice(1);
}

const enumLabels = {
  cover: 'Fill',
  contain: 'Whole',
  tags: 'Tags',
  kind: 'Kind',
  size: 'Size',
  modified: 'Modified',
  none: 'None',
  auto: 'Auto',
} as const;

/** Known display values keep their wire spelling while their labels are translated. */
export function optionTitle(value: string): string {
  return Object.hasOwn(enumLabels, value) ? t(enumLabels[value as keyof typeof enumLabels]) : value;
}

const descriptions = {
  'Text sent per file: 75% from the start, 25% from the end': true,
  'PDF pages read for text': true,
  'Pages rendered to images when a PDF has little text': true,
  'Text per page below which a PDF counts as scanned': true,
  'Images sent per file, from any source': true,
  'Longest image edge in pixels': true,
  'Spreadsheet sheets read': true,
  'Rows read per sheet': true,
  'Archive entry names read': true,
  'Larger files skip parsers that read the whole file': true,
  'The same limit for Office files, which inflate in memory': true,
  'Time limit per file': true,
  'Show files and folders whose names start with a dot': true,
  'Show everything under a folder. Off shows only what sits directly in it': true,
  'Show file name extensions': true,
  'Width of a grid tile in pixels, when grid_columns is 0': true,
  'Tiles per row. 0 fits as many as thumbnail_size allows': true,
  'Space between tiles in pixels': true,
  'Cover fills the tile and crops. Contain shows the whole thumbnail': true,
  'The line under a file name in the grid': true,
  'File name size in pixels': true,
  'Columns of the list, after the name': true,
  'Show thumbnails in the list, not icons': true,
  'Confidence at or above this joins the plan': true,
  'Confidence at or above this goes to review. Lower is dropped': true,
  'Answers without native probabilities never apply on their own': true,
  'Minutes between full checks, which catch missed events': true,
  'Interface language: system default, English, Japanese or Simplified Chinese': true,
  'Local server port. The next free port is used if this one is taken': true,
  'Maximum parallel model calls': true,
  'Hard cap of tags per file, counting tags a person added': true,
  'First month of the fiscal year, for fiscal-year tags': true,
  'Off keeps every image on this machine, including rendered PDF pages': true,
  'Colours by tag or by facet. Anything not named here gets its colour from its facet': true,
} as const;

/** Only schema copy known to the application is translated; other text stays literal. */
export function description(text: string | undefined): string | undefined {
  return text && Object.hasOwn(descriptions, text) ? t(text as keyof typeof descriptions) : text;
}

const keyHelp = {
  exclude: 'Name patterns to skip, such as *.tmp. Secret files such as .env are always skipped.',
} as const;

/** Help for a key whose schema has no description of its own. */
export function help(key: string, text: string | undefined): string | undefined {
  return (
    description(text) ?? (Object.hasOwn(keyHelp, key) ? t(keyHelp[key as 'exclude']) : undefined)
  );
}
