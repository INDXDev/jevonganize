import {
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileMusic,
  FileSpreadsheet,
  FileText,
  FileVideo,
  type LucideIcon,
  Mail,
} from 'lucide-react';
import { createElement } from 'react';
import { cn } from '../lib.ts';

/** The first match wins, so the broad patterns stay last. */
const ICONS: [RegExp, LucideIcon][] = [
  [/^image\//, FileImage],
  [/^audio\//, FileMusic],
  [/^video\//, FileVideo],
  [/sheet|excel|csv/, FileSpreadsheet],
  [/zip|tar|gzip/, FileArchive],
  [/rfc822|outlook/, Mail],
  [/json|javascript|typescript|html|xml|x-/, FileCode],
  [/^text|pdf|word|document|presentation/, FileText],
];

const iconFor = (mime: string) => ICONS.find(([pattern]) => pattern.test(mime))?.[1] ?? File;

/** The icon of a file's type. */
export function FileIcon({ mime, className }: { mime: string | null; className?: string }) {
  const classes = cn('size-4 shrink-0 text-subtle', className);
  return createElement(iconFor(mime ?? ''), { 'aria-hidden': true, className: classes });
}
