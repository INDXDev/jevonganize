import { describe, expect, it } from 'vitest';
import { configJsonSchema } from '../src/core/config.ts';
import { findSection, GROUPS, layout } from '../src/web/views/settings-layout.ts';

const keys = Object.keys(configJsonSchema().properties ?? {});

describe('settings layout', () => {
  it('places every config key on exactly one page', () => {
    const placed = GROUPS.flatMap((g) => g.sections.flatMap((s) => s.keys));
    expect(placed.toSorted()).toEqual(keys.toSorted());
    expect(new Set(placed).size).toBe(placed.length);
  });

  it('puts a key no page names on an Other page, so new keys still show', () => {
    const groups = layout([...keys, 'future_key']);
    const other = groups.flatMap((g) => g.sections).find((s) => s.id === 'other');
    expect(other?.keys).toEqual(['future_key']);
    expect(layout(keys)).toBe(GROUPS);
  });

  it('gives every page a unique id, a title and a description', () => {
    const sections = GROUPS.flatMap((g) => g.sections);
    expect(new Set(sections.map((s) => s.id)).size).toBe(sections.length);
    for (const s of sections) expect(s.title && s.description).toBeTruthy();
  });

  it('opens old section links on the page that holds them now', () => {
    expect(findSection(GROUPS, 'chat').id).toBe('models');
    expect(findSection(GROUPS, 'ner').id).toBe('models');
    expect(findSection(GROUPS, 'thresholds').id).toBe('tagging');
    expect(findSection(GROUPS, 'libraries').id).toBe('folders');
    expect(findSection(GROUPS, 'keys').id).toBe('keys');
    expect(findSection(GROUPS, undefined).id).toBe('general');
    expect(findSection(GROUPS, '__proto__').id).toBe('general');
  });
});
