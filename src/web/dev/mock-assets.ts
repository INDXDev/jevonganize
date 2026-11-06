/** Fake thumbnails and file bytes for the mock. */
import type { FileRow } from '../../types.ts';
import { DOCX_MIME, files } from './mock-files.ts';

const DOCX =
  'UEsDBBQAAAAIAEYKZl3mdcR+0gAAAIsBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH2QvVLDMAzHX8XnlasVGBh6SToAKzD0BXSOkvjw11luad++Sls6cIVR+n/8ZLebQ/BqT4Vdip1+NI3e9O32mImVKJE7Pdea1wBsZwrIJmWKooypBKwylgky2i+cCJ6a5hlsipViXdWlQ/ftK42481W9HWR9oRTyrNXLxbiwOo05e2exig77OPyirK4EI8mzh2eX+UEMGu4SFuVvwDX3Ic8ubiD1iaW+YxAXfKcywJDsLkjS/F9z5840js7SLb+05ZIsMbs4BW9uSkAXf+6H83f3J1BLAwQUAAAACABGCmZdXzOVUpUAAAAHAQAACwAAAF9yZWxzLy5yZWxzjc87DsIwDAbgq0Q+QJ0yMKCmXVi6Ii4QJW5T0TzkhNftycBAEQOjf//6LHfDw6/iRpyXGBS0jYSh70606lKD7JaURW2ErMCVkg6I2TjyOjcxUaibKbLXpY48Y9LmomfCnZR75E8DtqYYrQIebQvi/Ez0jx2naTF0jObqKZQfJ74aVdY8U1Fwj2zRvuOmsoB9h5sX+xdQSwMEFAAAAAgARgpmXfiqNy/VAAAAUgEAABEAAAB3b3JkL2RvY3VtZW50LnhtbG1QMW7DMAz8CuEHWG6HDoajbB0KBOjQD9ASKwu1KEFi7DSvj+ygKQp0ucPxiMORw/ESZlgoFx/50Dy1XXPUw9rbaM6BWKDaXPr10EwiqVeqmIkCljYm4up9xhxQqsxOrTHblKOhUjy7MKvnrntRAT03W+QY7ffGaYO8w/tOo9KDeijRJyKpAcBRqGyO3P0d098I0a/eSO2OMxQMaSZ4VK/dQCaCN1oiO2R/JQjRfLXwUadCGABdJrL71ni2jgSQ75LpIpBp8bSCRaH2nyLq5yj1+zB9A1BLAQIUAxQAAAAIAEYKZl3mdcR+0gAAAIsBAAATAAAAAAAAAAAAAACAAQAAAABbQ29udGVudF9UeXBlc10ueG1sUEsBAhQDFAAAAAgARgpmXV8zlVKVAAAABwEAAAsAAAAAAAAAAAAAAIABAwEAAF9yZWxzLy5yZWxzUEsBAhQDFAAAAAgARgpmXfiqNy/VAAAAUgEAABEAAAAAAAAAAAAAAIABwQEAAHdvcmQvZG9jdW1lbnQueG1sUEsFBgAAAAADAAMAuQAAAMUCAAAAAA==';

const hue = (id: number) => (id * 47) % 360;

function imageSvg(file: FileRow) {
  const h = hue(file.id);
  const sky = `hsl(${h} 45% ${28 + (file.id % 30)}%)`;
  const low = `hsl(${(h + 40) % 360} 50% 62%)`;
  const land = `hsl(${(h + 180) % 360} 22% 16%)`;
  const y = 120 + (file.id % 50);
  const sun = 40 + ((file.id * 13) % 240);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${sky}"/><stop offset="1" stop-color="${low}"/></linearGradient></defs><rect width="320" height="240" fill="url(#g)"/><circle cx="${sun}" cy="${y - 50}" r="20" fill="hsl(${h} 80% 86%)" opacity=".85"/><path d="M0 ${y}L60 ${y - 34}L120 ${y + 8}L190 ${y - 46}L250 ${y + 2}L320 ${y - 24}V240H0Z" fill="${land}" opacity=".7"/><path d="M0 ${y + 40}Q90 ${y + 8} 170 ${y + 44}T320 ${y + 30}V240H0Z" fill="${land}"/></svg>`;
}

function shotSvg(file: FileRow) {
  const bars = Array.from(
    { length: 7 },
    (_, i) =>
      `<rect x="${86 + (i % 2) * 12}" y="${38 + i * 24}" width="${90 + ((file.id * (i + 3)) % 130)}" height="9" rx="2" fill="#3a3e46"/>`,
  ).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240" preserveAspectRatio="xMidYMid slice"><rect width="320" height="240" fill="#16181c"/><rect width="320" height="20" fill="#24262b"/><circle cx="12" cy="10" r="3" fill="#71757e"/><circle cx="24" cy="10" r="3" fill="#71757e"/><rect y="20" width="70" height="220" fill="#1b1d21"/>${bars}</svg>`;
}

function pageSvg(file: FileRow) {
  const lines = Array.from(
    { length: 13 },
    (_, i) =>
      `<rect x="44" y="${74 + i * 12}" width="${232 - ((file.id * (i + 1)) % 80)}" height="4" fill="#c4c7cc"/>`,
  ).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240" preserveAspectRatio="xMidYMin slice"><rect width="320" height="240" fill="#23252a"/><rect x="24" y="14" width="272" height="360" fill="#f4f3ef"/><rect x="44" y="34" width="96" height="10" fill="#3c4048"/><rect x="216" y="34" width="60" height="22" fill="#d7dae0"/>${lines}</svg>`;
}

const svgFor = (file: FileRow) => {
  if (file.mime === 'application/pdf') return pageSvg(file);
  return file.mime === 'image/png' ? shotSvg(file) : imageSvg(file);
};

/** A data URL standing in for `/thumb/:id`. */
export function thumb(id: number, _size: number) {
  return `data:image/svg+xml,${encodeURIComponent(svgFor(files[id - 1]!))}`;
}

const pdfPage = (text: string) =>
  `BT /F1 18 Tf 60 720 Td (${text}) Tj 0 -28 Td /F1 11 Tf (Fictional sample for the Jevonganize mock.) Tj ET`;
const pdfStream = (s: string) => `<< /Length ${s.length} >>\nstream\n${s}\nendstream`;

function pdfBytes(row: FileRow) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 7 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '',
  ];
  objects[3] = pdfStream(pdfPage(row.name.replace(/[()]/g, '')));
  objects[6] = pdfStream(pdfPage('Page 2'));
  let out = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  return `${out}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}

const urls = new Map<number, string>();

function fileBody(row: FileRow) {
  if (row.mime === 'application/pdf') return pdfBytes(row);
  if (row.mime === DOCX_MIME) return Uint8Array.from(atob(DOCX), (c) => c.charCodeAt(0));
  return `# ${row.name}\n\nFictional notes for the mock.\n\n- Tags: ${row.tags.join(', ')}\n- Next review: Thursday\n`;
}

/** A blob URL standing in for `/file/:id`. */
export function fileUrl(id: number) {
  const known = urls.get(id);
  if (known) return known;
  const row = files[id - 1]!;
  const url = URL.createObjectURL(new Blob([fileBody(row)], { type: row.mime ?? 'text/plain' }));
  urls.set(id, url);
  return url;
}
