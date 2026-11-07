/** Writes THIRD_PARTY_NOTICES.md from the production dependency tree. Run: pnpm notices */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

interface Entry {
  name: string;
  versions: string[];
  homepage?: string;
}

const tree = JSON.parse(
  execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], {
    encoding: 'utf8',
    maxBuffer: 1 << 26,
  }),
) as Record<string, Entry[]>;

const rows = Object.entries(tree)
  .flatMap(([license, entries]) => entries.map((entry) => ({ ...entry, license })))
  .toSorted((a, b) => a.name.localeCompare(b.name));
const line = ({ name, versions, license, homepage }: (typeof rows)[number]) =>
  `| ${homepage ? `[${name}](${homepage})` : name} | ${versions.join(', ')} | ${license} |`;

writeFileSync(
  'THIRD_PARTY_NOTICES.md',
  `# Third-party notices

Jevonganize is MIT licensed. It uses the packages below, each under its own license.

\`presets/catalog.txt\` is a list of subject names drawn from Wikipedia's Vital Articles (CC BY-SA 4.0),
IPTC Media Topics (CC BY 4.0, IPTC) and OpenAlex (CC0). It stays under those terms, not the MIT license.

Two packages are under the LGPL: \`libheif-js\`, which decodes HEIC images, and the \`libvips\` binaries
that \`sharp\` loads. Both stay separate files from Jevonganize's own code and keep their own license.
Their source is at the links below. In the desktop app they sit unpacked in the \`resources\` folder.

| Package | Version | License |
| --- | --- | --- |
${rows.map(line).join('\n')}
`,
);
