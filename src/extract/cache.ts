/** Recent extraction results, in memory, so a file read twice in quick succession is parsed once. */
import type { FileState } from '../types.ts';

type Extraction = FileState & { mime: string };

interface CacheEntry {
  state: Extraction;
  sizeBytes: number;
  expiresAt: number;
}

const MAX_TOTAL_BYTES = 32 * 2 ** 20;
const MAX_ENTRIES = 64;
const TTL_MS = 30_000;
/** Strings are UTF-16 in memory, so each character costs two bytes. */
const BYTES_PER_CHAR = 2;

/** In insertion order, oldest first, which makes the first key the one to evict. */
const entries = new Map<string, CacheEntry>();
let totalBytes = 0;

function remove(key: string): void {
  const entry = entries.get(key);
  if (!entry) return;
  totalBytes -= entry.sizeBytes;
  entries.delete(key);
}

/** A copy of a recent, successful extraction, or undefined when absent or expired. */
export function cachedExtraction(key: string): Extraction | undefined {
  const entry = entries.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    remove(key);
    return undefined;
  }
  // Re-inserting marks it as the most recently used.
  entries.delete(key);
  entries.set(key, entry);
  return structuredClone(entry.state);
}

function estimatedBytes(state: Extraction): number {
  const textChars = state.text.length + JSON.stringify(state.metadata).length;
  const imageBytes = state.images.reduce((sum, image) => sum + image.data.byteLength, 0);
  return BYTES_PER_CHAR * textChars + imageBytes;
}

function evictUntilRoomFor(sizeBytes: number): void {
  const isFull = () => entries.size >= MAX_ENTRIES || totalBytes + sizeBytes > MAX_TOTAL_BYTES;
  while (entries.size > 0 && isFull()) {
    const oldestKey = entries.keys().next().value;
    if (oldestKey === undefined) return;
    remove(oldestKey);
  }
}

/** Keeps a bounded copy; callers must first verify that the source did not change. */
export function cacheExtraction(key: string, state: Extraction): void {
  if (state.warnings.length > 0) return;
  const sizeBytes = estimatedBytes(state);
  if (sizeBytes > MAX_TOTAL_BYTES) return;
  remove(key);
  evictUntilRoomFor(sizeBytes);
  entries.set(key, { state: structuredClone(state), sizeBytes, expiresAt: Date.now() + TTL_MS });
  totalBytes += sizeBytes;
}
