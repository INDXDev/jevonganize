/** What colour a tag shows in. Colours live in the config, never on the file. */
import type { TagColor } from '../core/config.ts';

export type Hue = Exclude<TagColor, 'auto'>;
export type TagColors = Record<string, TagColor>;

/** Every colour with its name, in picker order. A new one also needs its token in tokens.css. */
export const HUES = {
  red: 'Red',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  teal: 'Teal',
  blue: 'Blue',
  indigo: 'Indigo',
  purple: 'Purple',
  pink: 'Pink',
  gray: 'Gray',
} as const satisfies Record<Hue, string>;

/** Gray stays out: it is for someone who wants a tag to recede. */
const AUTO: Hue[] = [
  'blue',
  'green',
  'orange',
  'purple',
  'teal',
  'pink',
  'indigo',
  'yellow',
  'red',
];

/** The part before the colon, or the whole tag when it has no facet. */
export const facetOf = (tag: string) => tag.split(':', 1)[0]!;

/** FNV-1a, so that a facet keeps its colour on every machine and in every session. */
export function autoColor(tag: string): Hue {
  let hash = 0x811c9dc5;
  for (const char of facetOf(tag)) {
    hash = Math.imul(hash ^ char.codePointAt(0)!, 0x01000193);
  }
  return AUTO[(hash >>> 0) % AUTO.length]!;
}

/** `hasOwn`, because a tag can be named `constructor`. */
function chosen(colors: TagColors, key: string): Hue | undefined {
  const color = Object.hasOwn(colors, key) ? colors[key] : undefined;
  return color === 'auto' ? undefined : color;
}

/** The tag's own colour, else its facet's, else the automatic one. */
export const tagColor = (tag: string, colors: TagColors = {}): Hue =>
  chosen(colors, tag) ?? chosen(colors, facetOf(tag)) ?? autoColor(tag);
