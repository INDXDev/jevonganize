import { describe, expect, it } from 'vitest';
import { configSchema } from '../src/core/config.ts';
import { autoColor, facetOf, HUES, tagColor } from '../src/web/tag-colors.ts';

const accepted = (name: string) => configSchema.safeParse({ tag_colors: { topic: name } }).success;

describe('tagColor', () => {
  it('prefers the tag, then its facet, then the automatic colour', () => {
    const colors = { 'doc-type': 'green', 'doc-type:invoice': 'red' } as const;
    expect(tagColor('doc-type:invoice', colors)).toBe('red');
    expect(tagColor('doc-type:memo', colors)).toBe('green');
    expect(tagColor('topic:law', colors)).toBe(autoColor('topic:law'));
  });

  it('treats auto as not chosen, so a tag can go back to its facet', () => {
    const colors = { topic: 'pink', 'topic:law': 'auto' } as const;
    expect(tagColor('topic:law', colors)).toBe('pink');
  });

  it('is not fooled by a tag named after an Object member', () => {
    for (const tag of ['constructor', '__proto__', 'toString:x']) {
      expect(Object.keys(HUES)).toContain(tagColor(tag, {}));
    }
  });

  it('gives a whole facet one colour, and a tag with no facet its own', () => {
    expect(autoColor('topic:law')).toBe(autoColor('topic:tax'));
    expect(facetOf('is-draft')).toBe('is-draft');
  });

  it('spreads the default facets over several colours', () => {
    const facets = ['doc-type', 'topic', 'language', 'status', 'importance', 'year', 'month'];
    expect(new Set(facets.map(autoColor)).size).toBeGreaterThanOrEqual(4);
  });

  it('offers exactly the colours the config accepts', () => {
    for (const hue of Object.keys(HUES)) expect(accepted(hue)).toBe(true);
    expect(accepted('auto')).toBe(true);
    expect(accepted('mauve')).toBe(false);
  });
});
