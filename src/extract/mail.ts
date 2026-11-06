/** Mail: `.eml` and `.msg` reduce to one shape. Attachments are named and never opened. */
import { readFile } from 'node:fs/promises';
import type { FileState } from '../types.ts';
import { type Extractor, iso, put, readRange, setText } from './source.ts';

/** The body comes first in nearly all mail, and parsing a big attachment costs ten times its size. */
// shortcut: a body placed after this many bytes of attachments is lost, raise it if real mail needs it
const EML_BYTES = 2 * 2 ** 20;

interface Mail {
  subject?: string;
  from?: string;
  to?: string[];
  date?: string | number;
  body?: string;
  attachments?: (string | null | undefined)[];
}

function fillMail(state: FileState, mail: Mail) {
  put(state, 'subject', mail.subject);
  put(state, 'from', mail.from);
  put(state, 'to', mail.to?.join(', '));
  put(state, 'created', iso(mail.date));
  put(state, 'attachments', mail.attachments?.filter(Boolean).join(', '));
  setText(state, [mail.subject, mail.body].filter(Boolean).join('\n\n'));
}

const person = (name?: string, address?: string) =>
  name && address ? `${name} <${address}>` : (name ?? address);

// shortcut: drops tags with no entity decoding, use officeparser's HTML route if mail text reads badly
const htmlToText = (html: string) =>
  html.replace(/<(style|script)\b[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<[^>]*>/g, ' ');

/** Reads an RFC 822 message. */
export const eml: Extractor = async (file, state) => {
  const { default: PostalMime } = await import('postal-mime');
  const mail = await PostalMime.parse(await readRange(file.path, EML_BYTES));
  fillMail(state, {
    subject: mail.subject,
    from: person(mail.from?.name, mail.from?.address),
    to: mail.to?.map(({ name, address }) => person(name, address) ?? ''),
    date: mail.date,
    body: mail.text ?? htmlToText(mail.html ?? ''),
    attachments: mail.attachments.map(({ filename }) => filename),
  });
};

/** Reads an Outlook message. */
export const msg: Extractor = async (file, state) => {
  const { default: msgreader } = await import('@kenjiuno/msgreader');
  const bytes = await readFile(file.path);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const mail = new msgreader.default(view).getFileData();
  if (mail.error) throw new Error(mail.error);
  fillMail(state, {
    subject: mail.subject,
    from: person(mail.senderName, mail.senderSmtpAddress ?? mail.senderEmail),
    to: mail.recipients?.map(
      ({ name, smtpAddress, email }) => person(name, smtpAddress ?? email) ?? '',
    ),
    date: mail.messageDeliveryTime ?? mail.clientSubmitTime,
    body: mail.body,
    attachments: mail.attachments?.map(({ fileName, name }) => fileName ?? name),
  });
};
