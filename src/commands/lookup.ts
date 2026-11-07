/** `search`, `show` and `similar`: read the index, change nothing. */
import { t, statusLabel } from './i18n/index.ts';
import { sanitizeLine } from '../core/sanitize.ts';
import type { FileDetail } from '../types.ts';
import {
  callTool,
  count,
  fileArg,
  type JsonFlag,
  out,
  outJson,
  type QueryFlags,
  shown,
  someTags,
  toQuery,
  withContext,
} from './shared.ts';

const DEFAULT_SEARCH_LIMIT = 50;
const DEFAULT_SIMILAR_LIMIT = 20;
const KIB = 1024;

function sizeLabel(bytes: number): string {
  if (bytes < KIB) return `${bytes} B`;
  if (bytes < KIB ** 2) return `${Math.round(bytes / KIB)} KB`;
  return `${(bytes / KIB ** 2).toFixed(1)} MB`;
}

/** `YYYY-MM-DD`, in UTC. */
const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const confidenceLabel = (confidence: number | null) =>
  confidence === null ? 'n/a' : confidence.toFixed(2);

/** `search [text]`. */
export async function runSearch(
  text: string | undefined,
  flags: JsonFlag & QueryFlags,
): Promise<void> {
  await withContext(flags, async (ctx) => {
    const query = {
      limit: DEFAULT_SEARCH_LIMIT,
      ...toQuery(flags),
      ...(text !== undefined && { text }),
    };
    const result = await callTool('search_files', query, ctx);
    if (flags.json) return outJson(result);
    for (const file of result.files) {
      const cells = [shown(file.path), sizeLabel(file.size), isoDate(file.mtime_ms)];
      out(`${cells.join('  ')}  ${someTags(file.tags)}`);
    }
    const shownCount = count(result.files.length);
    return out(t('{shown} of {total} files', { shown: shownCount, total: count(result.total) }));
  });
}

function printFileDetail(file: FileDetail): void {
  out(`${shown(file.path)}  (id ${file.id})`);
  out(
    t('{mime}, {size}, modified {date}, {status}', {
      mime: sanitizeLine(file.mime ?? t('unknown type')),
      size: sizeLabel(file.size),
      date: isoDate(file.mtime_ms),
      status: statusLabel(file.status),
    }),
  );
  if (file.tags.length > 0)
    out(t('Tags     {tags}', { tags: file.tags.map(sanitizeLine).join('  ') }));
  const answered = file.answers.filter((answer) => answer.value !== null);
  if (answered.length > 0) {
    const answers = answered
      .map((answer) => `${answer.facet} ${answer.value} ${confidenceLabel(answer.confidence)}`)
      .join(' / ');
    out(t('Answers  {answers}', { answers: sanitizeLine(answers) }));
  }
  for (const item of file.reviews) {
    const confidence = confidenceLabel(item.confidence);
    out(t('Review   {tag} {confidence}', { tag: sanitizeLine(item.tag), confidence }));
  }
}

/** `show <file>`. */
export async function runShow(arg: string, flags: JsonFlag): Promise<void> {
  await withContext(flags, async (ctx) => {
    const file = await fileArg(arg, ctx);
    if (flags.json) return outJson(file);
    return printFileDetail(file);
  });
}

/** `similar <file>`. */
export async function runSimilar(arg: string, flags: JsonFlag & { limit?: number }): Promise<void> {
  await withContext(flags, async (ctx) => {
    const { id } = await fileArg(arg, ctx);
    const limit = flags.limit ?? DEFAULT_SIMILAR_LIMIT;
    const files = await callTool('similar_files', { id, limit }, ctx);
    if (flags.json) return outJson(files);
    for (const file of files) {
      const sharedTags = file.shared.map(sanitizeLine).join(' ');
      out(`${file.score.toFixed(2)}  ${shown(file.path)}  ${sharedTags}`);
    }
    return undefined;
  });
}
