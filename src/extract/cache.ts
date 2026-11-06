import type { FileState } from '../types.ts';

type Result = FileState & { mime: string };
const MAX_BYTES = 32 * 2 ** 20;
const MAX_ENTRIES = 64;
const TTL_MS = 30_000;
const entries = new Map<string, { state: Result; bytes: number; expires: number }>();
let bytes = 0;

/** A copy of a recent, successful extraction, or undefined when absent or expired. */
export function cachedExtraction(key: string): Result | undefined {
  const entry = entries.get(key);
  if (!entry) return undefined;
  if (entry.expires <= Date.now()) {
    entries.delete(key);
    bytes -= entry.bytes;
    return undefined;
  }
  entries.delete(key);
  entries.set(key, entry);
  return structuredClone(entry.state);
}

/** Keeps a bounded copy; callers must first verify that the source did not change. */
export function cacheExtraction(key: string, state: Result): void {
  if (state.warnings.length) return;
  const size =
    2 * (state.text.length + JSON.stringify(state.metadata).length) +
    state.images.reduce((sum, image) => sum + image.data.byteLength, 0);
  if (size > MAX_BYTES) return;
  const old = entries.get(key);
  if (old) {
    bytes -= old.bytes;
    entries.delete(key);
  }
  while (entries.size && (entries.size >= MAX_ENTRIES || bytes + size > MAX_BYTES)) {
    const first = entries.keys().next().value!;
    bytes -= entries.get(first)!.bytes;
    entries.delete(first);
  }
  entries.set(key, { state: structuredClone(state), bytes: size, expires: Date.now() + TTL_MS });
  bytes += size;
}
