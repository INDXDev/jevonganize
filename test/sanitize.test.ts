import { describe, expect, it } from 'vitest';
import { sanitize, sanitizeData, sanitizeLine } from '../src/core/sanitize.ts';

describe('sanitize', () => {
  it('neutralises terminal escapes', () => {
    expect(sanitize('\x1b]0;pwned\x07name')).toBe('?]0;pwned?name');
    expect(sanitize('a\u0085b\x9bc')).toBe('a?b?c'); // C1 controls
  });

  it('replaces bidi, zero-width and format characters', () => {
    for (const char of [
      '\u202E',
      '\u2066',
      '\u200E',
      '\u200F',
      '\u061C',
      '\u200B',
      '\uFEFF',
      '\u00AD',
    ]) {
      expect(sanitize(`a${char}b`)).toBe('a?b');
    }
  });

  it('replaces line separators and invisible tag characters', () => {
    expect(sanitize('a\u2028b\u2029c')).toBe('a?b?c');
    expect(sanitize('a\u{E0041}\u{E007F}b')).toBe('a??b');
  });

  it('keeps layout, ordinary text and joined emoji', () => {
    expect(sanitize('a\n\tb')).toBe('a\n\tb');
    expect(sanitize('山田商事 café')).toBe('山田商事 café');
    for (const emoji of ['👩‍💻', '👩🏽‍💻', '❤️‍🔥', '👨‍👩‍👧‍👦']) expect(sanitize(emoji)).toBe(emoji);
  });

  it('allows the zero-width joiner only between emoji', () => {
    expect(sanitize('a\u200Db')).toBe('a?b');
    expect(sanitize('\u200D👩')).toBe('?👩');
    expect(sanitize('👩\u200D')).toBe('👩?');
  });

  it('gives the same result when called twice on one string', () => {
    const text = '\x1b[31m\x1b[0m\u202E';
    expect(sanitize(text)).toBe('?[31m?[0m?');
    expect(sanitize(text)).toBe('?[31m?[0m?'); // a /g regex carries no state across calls
  });
});

describe('sanitizeLine', () => {
  it('also replaces newlines and tabs', () => {
    expect(sanitizeLine('a\nb\tc')).toBe('a?b?c');
  });
});

describe('sanitizeData', () => {
  it('cleans every string in a value, keys included', () => {
    const data = { 'tag\x1b': ['a\nb', { c: '\u202Ed' }], n: 1, none: null, yes: true };
    expect(sanitizeData(data)).toEqual({
      'tag?': ['a?b', { c: '?d' }],
      n: 1,
      none: null,
      yes: true,
    });
  });
});
