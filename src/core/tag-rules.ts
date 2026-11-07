/** What a tag may be: the spelling rules every store shares. See docs/tags.md. */
import type { Tag } from '../types.ts';
import { UserError } from './config.ts';

/** Fits one ext4 block with room to spare. Raise it only with evidence from real tag sets. */
const MAX_BYTES = 2048;
/** `,` is the Linux separator, `;` Explorer's, a newline breaks macOS, the rest is query syntax. */
const FORBIDDEN = /[\p{Cc},;"\\*?]/u;

/** NFC, trimmed, unique ignoring case with the first spelling kept, sorted by code unit. */
export function normalize(tags: Tag[]): Tag[] {
  const firstSpelling = new Map<string, Tag>();
  for (const tag of tags) {
    const clean = tag.normalize('NFC').trim();
    const caseless = clean.toLowerCase();
    if (clean && !firstSpelling.has(caseless)) firstSpelling.set(caseless, clean);
  }
  return [...firstSpelling.values()].toSorted();
}

/** Normalizes tags, and throws on the first one the rules forbid. */
export function validTags(tags: Tag[]): Tag[] {
  const clean = normalize(tags);
  const forbidden = clean.find((tag) => FORBIDDEN.test(tag));
  if (forbidden !== undefined) {
    throw new UserError(`Tag ${JSON.stringify(forbidden)} has a character tags cannot contain`);
  }
  return clean;
}

/** `validTags`, and also throws when the set is too big to store on the file at `path`. */
export function storableTags(path: string, tags: Tag[]): Tag[] {
  const clean = validTags(tags);
  const storedBytes = Buffer.byteLength(clean.join(','));
  if (storedBytes > MAX_BYTES) {
    throw new UserError(`The tags for ${path} are over ${MAX_BYTES} bytes`);
  }
  return clean;
}
