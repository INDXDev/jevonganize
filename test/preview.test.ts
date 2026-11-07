import { expect, it, vi } from 'vitest';
import { previewKind } from '../src/web/components/preview/index.tsx';

// `web/api.ts` needs a browser on load, and choosing a viewer does not touch it.
vi.mock('../src/web/api.ts', () => ({}));

const OOXML = 'application/vnd.openxmlformats-officedocument';

it.each([
  [`${OOXML}.spreadsheetml.sheet`, null],
  [`${OOXML}.presentationml.presentation`, null],
  [`${OOXML}.wordprocessingml.template`, null],
  ['application/vnd.ms-excel', null],
  ['application/x-shockwave-flash', null],
  [`${OOXML}.wordprocessingml.document`, 'word'],
  ['application/pdf', 'pdf'],
  ['text/csv', 'text'],
  ['application/json', 'text'],
  ['application/xml', 'text'],
  ['application/ld+json', 'text'],
  ['application/x-yaml', 'text'],
  ['application/toml', 'text'],
  ['application/javascript', 'text'],
  ['application/x-sh', 'text'],
])('%s previews as %s', (mime, kind) => {
  expect(previewKind(mime)).toBe(kind);
});
