/** The fictional text and metadata the fixture generator writes into files. */

/** A web page with a title and one paragraph. */
export const PAGE_HTML =
  '<!doctype html><html><head><title>Pier Notes</title></head>' +
  '<body><h1>Pier Notes</h1><p>The tide table is posted weekly.</p></body></html>';

/** A logo with a title, as an SVG. */
export const LOGO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><title>Lantern Logo</title>' +
  '<rect width="120" height="60" fill="#c33"/></svg>';

/** A mail with a Base64-encoded Japanese subject, two recipients and a PDF attachment. */
export const MAIL_LINES = [
  'From: Mira Quill <mira@example.test>',
  'To: Oren Vale <oren@example.test>, Tess Rowe <tess@example.test>',
  'Subject: =?UTF-8?B?5riv44Gu5LqI5a6a?=',
  'Date: Fri, 15 Mar 2024 09:30:00 +0000',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="b"',
  '',
  '--b',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'The parade route is attached.',
  '--b',
  'Content-Type: application/pdf; name="route.pdf"',
  'Content-Disposition: attachment; filename="route.pdf"',
  'Content-Transfer-Encoding: base64',
  '',
  'JVBERi0xLjQK',
  '--b--',
  '',
];

/** A fictional camera, artist, date and position. */
export const EXIF = {
  IFD0: { Make: 'Fictional', Model: 'Harbor 1', Artist: 'Mira Quill' },
  IFD2: { DateTimeOriginal: '2023:07:04 18:30:00' },
  IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '35/1 40/1 0/1' },
};

/** ffmpeg arguments for two seconds of test pattern, titled. */
export const CLIP_ARGS = [
  ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=5:duration=2'],
  ['-metadata', 'title=Pier Clip', '-pix_fmt', 'yuv420p'],
].flat();
