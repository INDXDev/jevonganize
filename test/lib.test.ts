import { beforeEach, expect, test } from 'vitest';
import { setLanguage } from '../src/web/i18n/index.ts';
import { formatCost } from '../src/web/lib.ts';

beforeEach(() => setLanguage('en'));

test('a cost is approximate, unknown is not free, and a fraction of a cent is not $0.00', () => {
  expect(formatCost(1.234)).toBe('≈ $1.23');
  expect(formatCost(0)).toBe('≈ $0.00');
  expect(formatCost(null)).toBe('cost unknown');
  expect(formatCost(0.000_003)).toBe('< $0.01');
});

test('Japanese says it as 未満', () => {
  setLanguage('ja');
  expect(formatCost(0.000_003)).toBe('$0.01未満');
});
