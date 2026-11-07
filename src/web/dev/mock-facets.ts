/** The facets the mock starts with. */
import type { Facet, FacetInfo } from '../../types.ts';
import type { ToolMap } from '../../tool-map.ts';

type FacetFields = Pick<Facet, 'id' | 'pack' | 'title' | 'kind'> & Partial<Facet>;

const base = (fields: FacetFields): FacetInfo => ({
  applies_to: [],
  weight: 1,
  enabled: fields.pack !== 'finance',
  custom: false,
  ...fields,
});

/** Every built-in facet. */
export const initialFacets: FacetInfo[] = [
  base({
    id: 'doc-type',
    pack: 'core',
    title: 'Document type',
    kind: 'choice',
    instructions: 'What kind of document is this?',
    values: {
      invoice: 'It asks for payment for goods or services.',
      receipt: 'It proves a payment was made.',
      contract: 'It sets out terms that parties agreed.',
      notes: 'Informal notes.',
    },
  }),
  base({
    id: 'topic',
    pack: 'core',
    title: 'Topic',
    kind: 'multi',
    instructions: 'What is it about?',
    open: true,
    values: {
      finance: 'Money, accounts, budgets.',
      legal: 'Law and agreements.',
      research: 'Reading and findings.',
      planning: 'Plans and schedules.',
    },
  }),
  base({
    id: 'doc-date',
    pack: 'time',
    title: 'Document date',
    kind: 'date',
    instructions: 'What date does the document itself carry?',
    precision: 'year',
  }),
  base({
    id: 'author',
    pack: 'time',
    title: 'Author',
    kind: 'field',
    field: 'author',
    weight: 0.5,
  }),
  base({
    id: 'sensitive',
    pack: 'sensitivity',
    title: 'Sensitive',
    kind: 'flag',
    instructions: 'Does it hold personal or financial details?',
    weight: 0.3,
  }),
  base({
    id: 'confidentiality',
    pack: 'sensitivity',
    title: 'Confidentiality',
    kind: 'level',
    instructions: 'How widely could this be shared?',
    levels: ['public', 'internal', 'restricted'],
  }),
  base({
    id: 'media',
    pack: 'media',
    title: 'Media kind',
    kind: 'choice',
    instructions: 'What kind of media is this?',
    applies_to: ['image/*', 'audio/*', 'video/*'],
    values: {
      photo: 'A camera photo.',
      screenshot: 'A capture of a screen.',
      audio: 'A sound recording.',
      video: 'A moving picture.',
    },
  }),
  base({
    id: 'subject',
    pack: 'media',
    title: 'Subject',
    kind: 'choice',
    instructions: 'What does the image show?',
    applies_to: ['image/*'],
    values: {
      landscape: 'Open scenery.',
      street: 'Streets and buildings.',
      food: 'Food or drink.',
      people: 'People.',
    },
  }),
  base({
    id: 'invoice-state',
    pack: 'finance',
    title: 'Invoice state',
    kind: 'choice',
    instructions: 'What is the payment state of this invoice?',
    applies_to: ['application/*', 'image/*'],
    values: {
      paid: 'It shows the invoice was paid: a receipt, or a paid stamp.',
      unpaid: 'It asks for payment that is still due.',
    },
  }),
  base({
    id: 'amount',
    pack: 'finance',
    title: 'Amount band',
    kind: 'level',
    instructions: 'How large is the total?',
    levels: ['small', 'medium', 'large'],
    apply_above: 0.9,
  }),
];

let facets = initialFacets;

/** Stands in for `list_facets`. */
export const listFacets = () => facets;

/** Stands in for `save_facet`: a saved facet is custom and enabled, new or replacing one. */
export function saveFacet(facet: ToolMap['save_facet'][0]) {
  const saved: FacetInfo = { ...facet, enabled: true, custom: true };
  const exists = facets.some((known) => known.id === facet.id);
  facets = exists
    ? facets.map((known) => (known.id === facet.id ? saved : known))
    : [...facets, saved];
  return facet;
}

/** Stands in for `set_enabled`. An id names a facet or a whole pack. */
export function setEnabled({ ids, enabled }: ToolMap['set_enabled'][0]) {
  facets = facets.map((facet) =>
    ids.includes(facet.id) || ids.includes(facet.pack) ? { ...facet, enabled } : facet,
  );
}

/** Stands in for `delete_facet`. */
export function deleteFacet({ id }: { id: string }) {
  facets = facets.filter((facet) => facet.id !== id);
}
