/** The fictional library of the mock: a seeded generator, so every load shows the same files. */
import type { FileRow } from '../../types.ts';

let seed = 42;
/** The next number of the seeded sequence, from 0 up to 1. */
export const rnd = () => (seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32;
const pick = <T>(list: readonly T[]) => list[Math.floor(rnd() * list.length)]!;
const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** The fictional home folder. */
export const HOME = '/Users/mika';
/** The libraries of a mock that has been set up. */
export const LIBS = [`${HOME}/Documents`, `${HOME}/Pictures`, `${HOME}/Downloads`];
const VENDORS = ['northwind', 'lumen-co', 'harbor-labs', 'fennel', 'kestrel-print', 'oakline'];
const PROJECTS = ['atlas', 'tidewater', 'juniper', 'meridian'];
const PLACES = ['kyoto', 'lisbon', 'oslo', 'home', 'studio'];
/** A day in milliseconds. */
export const DAY = 86_400_000;
/** The fixed "now" of the fictional data. */
export const NOW = Date.UTC(2026, 10, 5, 9, 30);

type Kind = { dir: string; ext: string; mime: string; make(i: number): [string, string[]] };

/** The type of a Word document. */
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const KINDS: Kind[] = [
  {
    dir: 'Documents/Finance/Invoices',
    ext: 'pdf',
    mime: 'application/pdf',
    make: (i) => {
      const v = pick(VENDORS);
      return [
        `invoice-${v}-${1000 + i}`,
        [
          'doc-type:invoice',
          `vendor:${v}`,
          'topic:finance',
          pick(['invoice-state:paid', 'invoice-state:unpaid']),
        ],
      ];
    },
  },
  {
    dir: 'Documents/Finance/Receipts',
    ext: 'pdf',
    mime: 'application/pdf',
    make: (i) => {
      const v = pick(VENDORS);
      return [`receipt-${v}-${i}`, ['doc-type:receipt', `vendor:${v}`, 'topic:finance/expenses']];
    },
  },
  {
    dir: 'Documents/Tax',
    ext: 'pdf',
    mime: 'application/pdf',
    make: (i) => [
      `tax-statement-${i}`,
      ['doc-type:statement', 'topic:finance/tax', 'flag:sensitive'],
    ],
  },
  {
    dir: 'Documents/Contracts',
    ext: 'docx',
    mime: DOCX_MIME,
    make: (i) => {
      const v = pick(VENDORS);
      return [
        `agreement-${v}-${i}`,
        ['doc-type:contract', `vendor:${v}`, 'topic:legal', 'flag:sensitive'],
      ];
    },
  },
  {
    dir: 'Documents/Notes',
    ext: 'md',
    mime: 'text/markdown',
    make: (i) => {
      const p = pick(PROJECTS);
      return [
        `notes-${p}-${i}`,
        ['doc-type:notes', `project:${p}`, pick(['topic:planning', 'topic:research'])],
      ];
    },
  },
  {
    dir: 'Documents/Projects',
    ext: 'docx',
    mime: DOCX_MIME,
    make: (i) => {
      const p = pick(PROJECTS);
      return [`brief-${p}-v${(i % 5) + 1}`, ['doc-type:report', `project:${p}`, 'topic:planning']];
    },
  },
  {
    dir: 'Documents/Projects',
    ext: 'xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    make: (i) => {
      const p = pick(PROJECTS);
      return [`budget-${p}-${i}`, ['doc-type:spreadsheet', `project:${p}`, 'topic:finance']];
    },
  },
  {
    dir: 'Pictures/Trips',
    ext: 'jpg',
    mime: 'image/jpeg',
    make: (i) => {
      const p = pick(PLACES);
      return [
        `IMG_${pad(2000 + i, 4)}`,
        [
          'media:photo',
          `place:${p}`,
          pick(['subject:landscape', 'subject:street', 'subject:food', 'subject:people']),
        ],
      ];
    },
  },
  {
    dir: 'Pictures/Screenshots',
    ext: 'png',
    mime: 'image/png',
    make: (i) => [
      `screenshot-${i}`,
      ['media:screenshot', pick(['topic:research', 'topic:planning'])],
    ],
  },
  {
    dir: 'Downloads',
    ext: 'zip',
    mime: 'application/zip',
    make: (i) => [`archive-${i}`, ['doc-type:archive']],
  },
  {
    dir: 'Downloads',
    ext: 'mp3',
    mime: 'audio/mpeg',
    make: (i) => [`voice-memo-${i}`, ['media:audio', 'topic:research']],
  },
  {
    dir: 'Downloads',
    ext: 'mp4',
    mime: 'video/mp4',
    make: (i) => [`clip-${i}`, ['media:video', `place:${pick(PLACES)}`]],
  },
];

const WEIGHTS = [6, 5, 2, 2, 4, 2, 2, 12, 3, 1, 1, 1];
const bag = KINDS.flatMap((k, i) => Array.from({ length: WEIGHTS[i]! }, () => k));

/** Every file of the mock. A file's id is its place in this list, plus one. */
export const files: FileRow[] = Array.from({ length: 2000 }, (_, i) => {
  const kind = pick(bag);
  const [stem, tags] = kind.make(i);
  const mtime = NOW - Math.floor(rnd() * 900) * DAY;
  const roll = rnd();
  const year = `doc-date:${new Date(mtime).getUTCFullYear()}`;
  const name = `${stem}.${kind.ext}`;
  return {
    id: i + 1,
    name,
    path: `${HOME}/${kind.dir}/${name}`,
    size: Math.floor(20_000 + rnd() * rnd() * 9_000_000),
    mtime_ms: mtime,
    mime: kind.mime,
    tags: roll < 0.08 ? [] : [...tags, year].toSorted(),
    status: roll < 0.08 ? 'new' : roll < 0.095 ? 'failed' : 'organized',
  };
});
