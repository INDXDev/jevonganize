/** What every extractor shares: its signature, safe writes to the state, and ranged file reads. */
import { open } from 'node:fs/promises';
import type { Budget } from '../core/config.ts';
import type { FileState } from '../types.ts';

/** The file being read. `deadline` (epoch ms) is when the pool will terminate this task. */
export interface SourceFile {
  path: string;
  name: string;
  size: number;
  mime: string;
  deadline: number;
  /** False when pixels would be discarded; dimensions and metadata are still needed. */
  images?: boolean;
  /** macOS marked it a screenshot. Read before the task, so that workers load no native code. */
  screenCapture?: boolean;
}

/** One step of the pipeline. It fills `state`, and leaves what an earlier step wrote alone. */
export type Extractor = (file: SourceFile, state: FileState, budget: Budget) => Promise<void>;

/** Records a metadata value, unless it is empty or an earlier extractor already set the key. */
export const put = (
  state: FileState,
  key: string,
  value: string | number | boolean | null | undefined,
) => {
  if (value !== undefined && value !== null && value !== '' && !Number.isNaN(value)) {
    state.metadata[key] ??= value;
  }
};

/** Records the file's text, unless an earlier extractor found some. */
export const setText = (state: FileState, text: string) => {
  state.text ||= text.trim();
};

/** A date as an ISO string, or undefined when a file's value is not a date. */
export function iso(value: string | number | Date | null | undefined): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** Reads at most `length` bytes, so that a huge file costs no more than the range. */
export async function readRange(path: string, length: number, position = 0): Promise<Buffer> {
  const handle = await open(path);
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(length), 0, length, position);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** A locked file is a finding about the file, not a failure to read it. */
export function passwordProtected(state: FileState) {
  put(state, 'encrypted', true);
  state.warnings.push('password protected');
}
