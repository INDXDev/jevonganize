/** Shared fixtures of the facet tests. */
import type { Facet } from '../src/types.ts';

/** The keys every asked facet needs. */
export const base = { pack: 'p', title: 't', applies_to: [], weight: 1, instructions: 'Q?' };
export const flag: Facet = { ...base, id: 'has-x', kind: 'flag' };
export const choice: Facet = { ...base, id: 'kind', kind: 'choice', values: { a: 'A.', b: 'B.' } };
export const multi: Facet = {
  ...base,
  id: 'topic',
  kind: 'multi',
  open: true,
  values: { a: 'A.', 'b/c': 'C.' },
};
export const level: Facet = { ...base, id: 'lvl', kind: 'level', levels: ['low', 'mid', 'high'] };
export const date: Facet = { ...base, id: 'when', kind: 'date', precision: 'month' };
/** A `field` facet copying the metadata key `name`. */
export const field = (id: string, name: string, format?: Facet['format']): Facet => ({
  ...base,
  id,
  kind: 'field',
  field: name,
  format,
});
