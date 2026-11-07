import { describe, expect, it } from 'vitest';
import { displayName, gridLayout, kindOf } from '../src/web/view-options.ts';

const OPTIONS = {
  thumbnail_size: 160,
  grid_columns: 0,
  grid_spacing: 10,
  grid_info: 'tags',
  text_size: 12,
} as const;

describe('gridLayout', () => {
  it('fits tiles by size, and never fewer than one', () => {
    expect(gridLayout(1000, 16, OPTIONS).columns).toBe(5);
    expect(gridLayout(100, 16, OPTIONS).columns).toBe(1);
  });

  it('counts a gap only between tiles', () => {
    expect(gridLayout(330, 16, OPTIONS).columns).toBe(2);
    expect(gridLayout(329, 16, OPTIONS).columns).toBe(1);
  });

  it('lets a fixed count win, and shares the width', () => {
    const { columns, tile } = gridLayout(1000, 16, { ...OPTIONS, grid_columns: 4 });
    expect(columns).toBe(4);
    expect(tile).toBe(242.5);
  });

  it('follows the UI scale', () => {
    expect(gridLayout(1000, 32, OPTIONS).columns).toBe(3);
  });

  it('gives a row room for its text', () => {
    const plain = gridLayout(1000, 16, OPTIONS).rowHeight;
    expect(gridLayout(1000, 16, { ...OPTIONS, text_size: 20 }).rowHeight).toBeGreaterThan(plain);
    expect(gridLayout(1000, 16, { ...OPTIONS, grid_info: 'none' }).rowHeight).toBeLessThan(plain);
  });
});

describe('displayName', () => {
  it('drops an extension only when asked', () => {
    expect(displayName('a.tar.gz', true)).toBe('a.tar.gz');
    expect(displayName('a.tar.gz', false)).toBe('a.tar');
    expect(displayName('notes', false)).toBe('notes');
  });

  it('keeps a dotfile whole', () => {
    expect(displayName('.zshrc', false)).toBe('.zshrc');
  });
});

describe('kindOf', () => {
  it('names common types, and falls back', () => {
    expect(kindOf({ mime: 'image/png' })).toBe('Image');
    expect(kindOf({ mime: 'application/pdf' })).toBe('PDF');
    expect(kindOf({ mime: 'application/vnd.ms-excel' })).toBe('Spreadsheet');
    expect(kindOf({ mime: null })).toBe('File');
  });
});
