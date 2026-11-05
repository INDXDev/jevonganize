/** Worker entry: each export is a task that `runTask` can name. Runs the pipeline for one file. */
import type { Config } from '../core/config.ts';
import type { FileState } from '../types.ts';
import { extractors, sniff } from './extractors.ts';
import { renderThumbnail } from './thumbs.ts';

/** Metadata comes from the file too, and has no budget of its own. */
const METADATA_CHARS = 500;
const INVISIBLE = /[\p{Cf}--[\u200D]]/gv;

const clean = (text: string) => text.replace(INVISIBLE, '');

function capText(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const head = Math.floor(budget * 0.75);
  return `${text.slice(0, head)}\n[...]\n${text.slice(head - budget)}`.toWellFormed();
}

const glob = (pattern: string) =>
  new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')}$`);

export async function extract(input: {
  path: string;
  name: string;
  size: number;
  deadline: number;
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
  const row = config.pipeline.find(({ match }) => glob(match).test(mime));
  for (const id of row?.use ?? []) {
    try {
      await extractors[id]!({ ...source, mime }, state, config.budget);
    } catch (error) {
      state.warnings.push(`${id}: ${(error as Error).message}`);
    }
  }
  for (const [key, value] of Object.entries(state.metadata)) {
    if (typeof value === 'string')
      state.metadata[key] = clean(value).slice(0, METADATA_CHARS).toWellFormed();
  }
  return {
    mime,
    text: capText(clean(state.text), config.budget.text_chars),
    images: config.send_images ? state.images : [],
    metadata: state.metadata,
    warnings: [...new Set(state.warnings)],
  };
}

export { renderThumbnail };
