/** Worker entry: each export is a task that `runTask` can name. Runs the pipeline for one file. */
import type { Config } from '../core/config.ts';
import type { FileState } from '../types.ts';
import { extractors } from './extractors.ts';
import { sniff } from './sniff.ts';
import { renderThumbnail } from './thumb-render.ts';
import { closePdfs } from './pdf.ts';
import type { SourceFile } from './source.ts';

export { renderThumbnail };

/** Metadata comes from the file too, and has no budget of its own. */
const METADATA_CHARS = 500;
/** Format characters can reorder or hide text. The zero-width joiner stays, as emoji need it. */
const INVISIBLE_FORMAT_CHARS = /[\p{Cf}--[‍]]/gv;
/** A cut text keeps more of its start than its end: the start usually says what a file is. */
const HEAD_SHARE = 0.75;
const REGEXP_SPECIAL_CHARS = /[.+?^${}()|[\]\\]/g;

const removeInvisible = (text: string) => text.replace(INVISIBLE_FORMAT_CHARS, '');

/** The text cut to `budget` characters, with its start and end kept and `[...]` between. */
function capText(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const headLength = Math.floor(budget * HEAD_SHARE);
  const tailLength = budget - headLength;
  return `${text.slice(0, headLength)}\n[...]\n${text.slice(-tailLength)}`.toWellFormed();
}

/** A `[[pipeline]]` match is a glob over the MIME type, where `*` is the only wildcard. */
function matchesGlob(pattern: string, mime: string): boolean {
  const escaped = pattern.replace(REGEXP_SPECIAL_CHARS, '\\$&').replaceAll('*', '.*');
  return new RegExp(`^${escaped}$`).test(mime);
}

/** The extractor ids of the first `[[pipeline]]` row that matches, or none. */
const extractorsFor = (config: Config, mime: string) =>
  config.pipeline.find(({ match }) => matchesGlob(match, mime))?.use ?? [];

/** Runs each extractor in turn. One that throws leaves a warning, and the rest still run. */
async function runPipeline(ids: string[], file: SourceFile, state: FileState, config: Config) {
  try {
    for (const id of ids) {
      try {
        await extractors[id]!(file, state, config.budget);
      } catch (error) {
        state.warnings.push(`${id}: ${(error as Error).message}`);
      }
    }
  } finally {
    await closePdfs(state);
  }
}

function trimMetadata(metadata: FileState['metadata']): void {
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value !== 'string') continue;
    metadata[key] = removeInvisible(value).slice(0, METADATA_CHARS).toWellFormed();
  }
}

/** Worker task: sniffs the file, runs its pipeline row, and cuts the result to the budget. */
export async function extract(input: {
  path: string;
  name: string;
  size: number;
  deadline: number;
  screenCapture: boolean;
  config: Config;
}): Promise<FileState & { mime: string }> {
  const { config, ...source } = input;
  const mime = await sniff(source.path);
  const state: FileState = {
    text: '',
    images: [],
    metadata: { name: source.name, size: source.size, mime },
    warnings: [],
  };
  const file = { ...source, mime, images: config.send_images };
  await runPipeline(extractorsFor(config, mime), file, state, config);
  trimMetadata(state.metadata);
  return {
    mime,
    text: capText(removeInvisible(state.text), config.budget.text_chars),
    images: config.send_images ? state.images : [],
    metadata: state.metadata,
    warnings: [...new Set(state.warnings)],
  };
}
