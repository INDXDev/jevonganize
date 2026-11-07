import { describe, expect, test } from 'vitest';
import { configSchema } from '../src/core/config.ts';
import { derive } from '../src/core/answer-tags.ts';
import type { Facet, FileState } from '../src/types.ts';
import { field, flag } from './facets-helpers.ts';

const config = configSchema.parse({});

/** A creation time in March, after the default fiscal year starts in April of the year before. */
const CREATED_IN_MARCH = '2026-03-15T10:00:00Z';

/** What an extractor read from a file that holds only this metadata. */
const withMetadata = (metadata: FileState['metadata']): FileState => ({
  text: '',
  images: [],
  metadata,
  warnings: [],
});

/** The tag `facet` derives from a file holding only this metadata, under the default config. */
const derived = (facet: Facet, metadata: FileState['metadata']) =>
  derive(facet, withMetadata(metadata), config);

describe('derive dates', () => {
  test.each([
    ['year', 'year:2026'],
    ['month', 'month:2026-03'],
    ['fiscal-year', 'fiscal-year:FY2025'],
  ] as const)('format %s', (format, tag) => {
    expect(derived(field(format, 'created', format), { created: CREATED_IN_MARCH })).toBe(tag);
  });

  test('a fiscal year starts at fiscal_year_start', () => {
    const fiscalYear = field('fiscal-year', 'created', 'fiscal-year');
    expect(derived(fiscalYear, { created: '2026-04-01' })).toBe('fiscal-year:FY2026');
    const calendarYear = { ...config, fiscal_year_start: 1 };
    const inMarch = withMetadata({ created: CREATED_IN_MARCH });
    expect(derive(fiscalYear, inMarch, calendarYear)).toBe('fiscal-year:FY2026');
  });

  test('a date that does not parse gives no tag', () => {
    const year = field('year', 'created', 'year');
    expect(derived(year, { created: 'yesterday' })).toBeNull();
    expect(derived(year, { created: '2026-13-45' })).toBeNull();
    expect(derived(field('m', 'created', 'month'), { created: '2026' })).toBeNull();
    expect(derived(year, {})).toBeNull();
  });
});

describe('derive values', () => {
  test('booleans write a flag or nothing', () => {
    const screenshot = field('is-screenshot', 'screenshot');
    expect(derived(screenshot, { screenshot: true })).toBe('flag:is-screenshot');
    expect(derived(screenshot, { screenshot: false })).toBeNull();
  });

  test('values are cleaned, so a hostile file cannot break the grammar', () => {
    const author = field('author', 'author');
    expect(derived(author, { author: 'Doe, Jane' })).toBe('author:doe-jane');
    expect(derived(author, { author: 'a/b‮;"c\n' })).toBe('author:a-b-c');
    expect(derived(author, { author: ' ,;* ' })).toBeNull();
    expect(derived(author, { author: 'x'.repeat(100) })).toHaveLength(64);
  });

  test('only the first recipient of `to` counts', () => {
    expect(derived(field('recipient', 'to'), { to: 'Ann Lee, Bob' })).toBe('recipient:ann-lee');
  });

  test('a facet of another kind derives nothing', () => {
    expect(derived(flag, { 'has-x': true })).toBeNull();
  });
});
