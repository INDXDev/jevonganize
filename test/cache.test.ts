import { afterEach, describe, expect, it, vi } from 'vitest';
import { cacheExtraction, cachedExtraction } from '../src/extract/cache.ts';
const state = () => ({
  text: 'hello',
  images: [{ data: new Uint8Array([1]), mediaType: 'image/jpeg', source: 'file' }],
  metadata: { name: 'fixture' },
  mime: 'image/jpeg',
  warnings: [] as string[],
});
afterEach(() => vi.restoreAllMocks());

describe('the bounded extraction cache', () => {
  it('copies on both insertion and retrieval', () => {
    const original = state();
    cacheExtraction('copies', original);
    original.text = 'changed';
    original.images[0]!.data[0] = 99;
    const first = cachedExtraction('copies')!;
    expect(first.text).toBe('hello');
    expect(first.images[0]!.data[0]).toBe(1);
    first.metadata.name = 'other';
    first.images[0]!.data[0] = 42;
    expect(cachedExtraction('copies')!.metadata.name).toBe('fixture');
    expect(cachedExtraction('copies')!.images[0]!.data[0]).toBe(1);
  });
  it('expires entries and never retains warned or oversized results', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    cacheExtraction('expires', state());
    now.mockReturnValue(31000);
    expect(cachedExtraction('expires')).toBeUndefined();
    cacheExtraction('warning', { ...state(), warnings: ['retry later'] });
    expect(cachedExtraction('warning')).toBeUndefined();
    cacheExtraction('oversized', { ...state(), text: 'x'.repeat(17 * 2 ** 20) });
    expect(cachedExtraction('oversized')).toBeUndefined();
  });
  it('bounds entry count and retains a recently used entry', () => {
    for (let i = 0; i < 64; i++) cacheExtraction(`bounded-${i}`, state());
    expect(cachedExtraction('bounded-0')).toBeDefined();
    cacheExtraction('bounded-64', state());
    expect(cachedExtraction('bounded-1')).toBeUndefined();
    expect(cachedExtraction('bounded-0')).toBeDefined();
  });
});
