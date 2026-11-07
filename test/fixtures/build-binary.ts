/** Builds binary fixtures by hand: Shift_JIS text, an MP3 with ID3 tags, and compound files. */
import { burn } from '@kenjiuno/msgreader/lib/Burner.js';
import { TypeEnum } from '@kenjiuno/msgreader/lib/Reader.js';

/** Encodes text as Shift_JIS by reversing the decoder, because the platform has no encoder. */
export function shiftJis(text: string): Buffer {
  const decoder = new TextDecoder('shift_jis');
  const bytesOf = new Map<string, number[]>();
  for (let lead = 0x81; lead <= 0xfc; lead++) {
    for (let trail = 0x40; trail <= 0xfc; trail++) {
      bytesOf.set(decoder.decode(new Uint8Array([lead, trail])), [lead, trail]);
    }
  }
  const encode = (char: string) => {
    const code = char.charCodeAt(0);
    return code < 0x80 ? [code] : bytesOf.get(char)!;
  };
  return Buffer.from(Array.from(text).flatMap(encode));
}

/** An ID3v2.3 text frame: a 10-byte header, then the text in Latin-1. */
function id3Frame(id: string, text: string): Buffer {
  const body = Buffer.from(`\0${text}`, 'latin1');
  const head = Buffer.alloc(10);
  head.write(id, 'latin1');
  head.writeUInt32BE(body.length, 4);
  return Buffer.concat([head, body]);
}

/** A tag size as ID3 stores it: four bytes of seven bits each. */
const syncsafe = (size: number) =>
  Buffer.from([3, 2, 1, 0].map((shift) => (size >> (shift * 7)) & 0x7f));

/** An MP3 of forty silent frames, tagged with a fictional title, artist, album, genre and year. */
export function mp3(): Buffer {
  const tags = Buffer.concat([
    id3Frame('TIT2', 'Harbor Lights'),
    id3Frame('TPE1', 'The Pier Quartet'),
    id3Frame('TALB', 'Night Ferry'),
    id3Frame('TCON', 'Jazz'),
    id3Frame('TYER', '2023'),
  ]);
  const header = Buffer.concat([Buffer.from('ID3\x03\0\0', 'latin1'), syncsafe(tags.length)]);
  const silentFrame = Buffer.alloc(417); // one MPEG-1 layer III frame: 128 kbit/s, 44.1 kHz
  silentFrame.set([0xff, 0xfb, 0x90, 0x00]);
  return Buffer.concat([header, tags, ...Array.from({ length: 40 }, () => silentFrame)]);
}

/** The streams of one storage in a compound file, by name. */
type Streams = Record<string, Uint8Array>;

/** A compound file with the streams of an Outlook message, or of an encrypted OOXML package. */
export function cfb(streams: Streams, storages: Record<string, Streams> = {}) {
  const entries: Parameters<typeof burn>[0] = [
    { name: 'Root Entry', type: TypeEnum.ROOT, length: 0, children: [] },
  ];
  const rootChildren = entries[0]!.children!;
  const addStream = (name: string, data: Uint8Array, parent: number[]) => {
    parent.push(entries.length);
    entries.push({ name, type: TypeEnum.DOCUMENT, length: data.length, binaryProvider: () => data });
  };
  for (const [name, data] of Object.entries(streams)) addStream(name, data, rootChildren);
  for (const [name, children] of Object.entries(storages)) {
    const list: number[] = [];
    rootChildren.push(entries.length);
    entries.push({ name, type: TypeEnum.DIRECTORY, length: 0, children: list });
    for (const [child, data] of Object.entries(children)) addStream(child, data, list);
  }
  return burn(entries);
}

// A copy: `burn` reads the backing store, and a small Buffer shares Node's pool.
const utf16 = (text: string) => Uint8Array.from(Buffer.from(text, 'utf16le'));

/** An Outlook message from Mira Quill to Oren Vale about the ferry timetable. */
export function msg() {
  return cfb(
    {
      '__properties_version1.0': new Uint8Array(32),
      '__substg1.0_0037001F': utf16('Ferry timetable change'),
      '__substg1.0_1000001F': utf16('The evening ferry now leaves at seven.'),
      '__substg1.0_0C1A001F': utf16('Mira Quill'),
      '__substg1.0_0C1F001F': utf16('mira@example.test'),
    },
    {
      '__recip_version1.0_#00000000': {
        '__properties_version1.0': new Uint8Array(8),
        '__substg1.0_3001001F': utf16('Oren Vale'),
        '__substg1.0_39FE001F': utf16('oren@example.test'),
      },
    },
  );
}

/** An OOXML file as Office saves it with a password: only the encryption streams show. */
export const encryptedOoxml = () =>
  cfb({ EncryptionInfo: new Uint8Array(64), EncryptedPackage: new Uint8Array(64) });
