/** Mail: `.eml` and `.msg` reduce to one shape. Attachments are named and never opened. */
import { readFile } from 'node:fs/promises';
import type { FileState } from '../types.ts';
import { type Extractor, iso, put, readRange, setText } from './source.ts';

/** The body comes first in nearly all mail, and parsing a big attachment costs ten times its size. */
// shortcut: a body placed after this many bytes of attachments is lost, raise it if real mail needs it
const EML_BYTES = 2 * 2 ** 20;

/** The one shape both formats reduce to. Attachments are names only. */
interface Mail {
  subject?: string;
  from?: string;
  to?: string[];
  date?: string | number;
  body?: string;
  attachmentNames?: (string | null | undefined)[];
}

/** Writes a message's headers as metadata, and its subject and body as text. */
function recordMail(state: FileState, mail: Mail) {
  const attachments = mail.attachmentNames?.filter(Boolean).join(', ');
  put(state, 'subject', mail.subject);
  put(state, 'from', mail.from);
  put(state, 'to', mail.to?.join(', '));
  put(state, 'created', iso(mail.date));
  put(state, 'attachments', attachments);
  setText(state, [mail.subject, mail.body].filter(Boolean).join('\n\n'));
}

/** `Name <address>`, or whichever of the two the message gives. */
const mailbox = (name?: string, address?: string) =>
  name && address ? `${name} <${address}>` : (name ?? address);

// shortcut: drops tags with no entity decoding, use officeparser's HTML route if mail text reads badly
const htmlToText = (html: string) =>
  html.replace(/<(style|script)\b[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<[^>]*>/g, ' ');

/** Reads an RFC 822 message. */
export const eml: Extractor = async (file, state) => {
  const { default: PostalMime } = await import('postal-mime');
  const mail = await PostalMime.parse(await readRange(file.path, EML_BYTES));
  recordMail(state, {
    subject: mail.subject,
    from: mailbox(mail.from?.name, mail.from?.address),
    to: mail.to?.map(({ name, address }) => mailbox(name, address) ?? ''),
    date: mail.date,
    body: mail.text ?? htmlToText(mail.html ?? ''),
    attachmentNames: mail.attachments.map(({ filename }) => filename),
  });
};

/** Reads an Outlook message. */
export const msg: Extractor = async (file, state) => {
  const { default: msgreader } = await import('@kenjiuno/msgreader');
  const bytes = await readFile(file.path);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const mail = new msgreader.default(view).getFileData();
  if (mail.error) throw new Error(mail.error);
  recordMail(state, {
    subject: mail.subject,
    from: mailbox(mail.senderName, mail.senderSmtpAddress ?? mail.senderEmail),
    to: mail.recipients?.map(
      ({ name, smtpAddress, email }) => mailbox(name, smtpAddress ?? email) ?? '',
    ),
    date: mail.messageDeliveryTime ?? mail.clientSubmitTime,
    body: mail.body,
    attachmentNames: mail.attachments?.map(({ fileName, name }) => fileName ?? name),
  });
};
