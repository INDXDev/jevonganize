/**
 * `jevonganize folders suggest`: folders worth saving, or tags for a rule being built. Both come
 * from tag counts in the index, so nothing is sent. Thin: the tools do the work.
 */
import { t } from './i18n/index.ts';
import type { Command } from 'commander';
import { indexedPath } from '../core/config.ts';
import { sanitizeLine } from '../core/sanitize.ts';
import type { VfolderSuggestion, VfolderTagQuery, VfolderTagSuggestions } from '../tool-map.ts';
import {
  callTool,
  command,
  count,
  type JsonFlag,
  out,
  outJson,
  repeat,
  withContext,
} from './shared.ts';

/** The flags of `folders suggest`. The rule flags mean what they mean for `folders add`. */
interface SuggestFlags extends JsonFlag {
  tags?: boolean;
  tag?: string[];
  notTag?: string[];
  all?: boolean;
  folder?: string;
  limit?: number;
}

/** True when the flags describe a rule, so the person wants tags for it rather than folders. */
const wantsTags = (flags: SuggestFlags) =>
  Boolean(flags.tags) || flags.tag !== undefined || flags.notTag !== undefined;

/** The rule the flags describe, with the same defaults as `folders add`. */
function ruleFromFlags(flags: SuggestFlags): VfolderTagQuery {
  return {
    tags: flags.tag ?? [],
    tag_match: flags.all ? 'all' : 'any',
    exclude_tags: flags.notTag ?? [],
    ...(flags.folder !== undefined && { folder: indexedPath(flags.folder) }),
    ...(flags.limit !== undefined && { limit: flags.limit }),
  };
}

/** One line per folder: name, files, rule and why. */
function printFolderSuggestions(suggestions: VfolderSuggestion[]): void {
  if (suggestions.length === 0) {
    out(t('Nothing to suggest yet. Scan and organize some files first.'));
    return;
  }
  for (const { name, rule, count: files, reason } of suggestions) {
    const ruleText = rule.tags.join(rule.tag_match === 'any' ? ' | ' : ' & ');
    out(`${sanitizeLine(name)}  ${count(files)}  ${sanitizeLine(ruleText)}  ${reason}`);
  }
}

/** The rule's total, then one line per tag: its files in the rule over all its files, and why. */
function printTagSuggestions({ matches, suggestions }: VfolderTagSuggestions): void {
  out(t('{count} files match this rule.', { count: count(matches) }));
  for (const { tag, count: files, with_rule: inRule, reason } of suggestions) {
    out(`${sanitizeLine(tag)}  ${count(inRule)}/${count(files)}  ${reason}`);
  }
}

/** Runs `folders suggest`. */
async function runFolderSuggest(flags: SuggestFlags): Promise<void> {
  await withContext(flags, async (ctx) => {
    if (wantsTags(flags)) {
      const tags = await callTool('suggest_vfolder_tags', ruleFromFlags(flags), ctx);
      return flags.json ? outJson(tags) : printTagSuggestions(tags);
    }
    const limit = flags.limit === undefined ? {} : { limit: flags.limit };
    const folders = await callTool('suggest_vfolders', limit, ctx);
    return flags.json ? outJson(folders) : printFolderSuggestions(folders);
  });
}

/** Adds `folders suggest` under `folders`. */
export function addFolderSuggestCommand(folders: Command): void {
  const help = t(
    'Suggest folders to save, or with --tags, tags for a rule. From tag counts; calls no model',
  );
  command(folders, 'suggest', help)
    .option('--tags', t('Suggest tags for the rule given by --tag, --not-tag and --folder'))
    .option('--tag <tag>', t('Collect files with this tag. Repeatable'), repeat)
    .option('--all', t('Repeated --tag: a file needs all of them, not any'))
    .option('--not-tag <tag>', t('Leave out files with this tag. Repeatable'), repeat)
    .option('--folder <path>', t('Only this folder'))
    .option('--limit <n>', t('At most this many'), Number)
    .action(runFolderSuggest);
}
