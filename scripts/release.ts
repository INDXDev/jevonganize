/**
 * Release checks for CI. See docs/releasing.md.
 *
 *   node scripts/release.ts notes <tag>   Checks the tag against package.json and CHANGELOG.md, then
 *                                         prints that version's CHANGELOG section as release notes.
 *   npm pack --dry-run --json | node scripts/release.ts pack-check
 *                                         Checks what the npm tarball would contain.
 */
import { readFileSync } from 'node:fs';

/** A plain release tag. Pre-releases are not supported, as npm would publish them as `latest`. */
const TAG = /^(?:refs\/tags\/)?v(\d+\.\d+\.\d+)$/;

/** Throws unless `tag` is `v` plus the package version. Returns the version. */
export function checkTag(tag: string, packageVersion: string): string {
  const version = TAG.exec(tag)?.[1];
  if (!version) throw new Error(`The tag ${tag} is not of the form vX.Y.Z.`);
  if (version !== packageVersion) {
    throw new Error(`The tag ${tag} does not match package.json version ${packageVersion}.`);
  }
  return version;
}

/**
 * Returns the body of the `## X.Y.Z` section of a changelog, trimmed. A heading may add a date, as in
 * `## 0.1.0 - 2026-11-30`. Throws when the section is missing or empty.
 */
export function changelogSection(changelog: string, version: string): string {
  const lines = changelog.split(/\r?\n/);
  const escaped = version.replaceAll('.', '\\.');
  const heading = new RegExp(`^## \\[?v?${escaped}\\]?(\\s|$)`);
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) throw new Error(`CHANGELOG.md has no "## ${version}" section.`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  const body = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
  if (!body) throw new Error(`The "## ${version}" section of CHANGELOG.md is empty.`);
  return body;
}

/** Paths the npm tarball must contain. */
const REQUIRED = [
  'package.json',
  'dist/cli.mjs',
  'dist/web/index.html',
  'presets/core.toml',
  'LICENSE',
];

/** Path prefixes and suffixes that must never be published. */
const FORBIDDEN = [
  /^src\//,
  /^test\//,
  /^e2e\//,
  /^internal\//,
  /^scripts\//,
  /^examples\//,
  /^docs\//,
  /^release\//,
  /^\.github\//,
  /^node_modules\//,
  /\.map$/,
  /(^|\/)\.env/,
];

/** Returns a problem for each missing or forbidden path in an `npm pack --dry-run --json` listing. */
export function packProblems(listing: string): string[] {
  const [pack] = JSON.parse(listing) as { files: { path: string }[] }[];
  if (!pack) return ['npm pack printed no package.'];
  const paths = pack.files.map((file) => file.path.replaceAll('\\', '/'));
  return [
    ...REQUIRED.filter((path) => !paths.includes(path)).map((path) => `Missing: ${path}`),
    ...paths
      .filter((path) => FORBIDDEN.some((pattern) => pattern.test(path)))
      .map((path) => `Must not be published: ${path}`),
  ];
}

function main([command, arg]: string[]): void {
  if (command === 'notes' && arg) {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    const version = checkTag(arg, pkg.version);
    process.stdout.write(`${changelogSection(readFileSync('CHANGELOG.md', 'utf8'), version)}\n`);
  } else if (command === 'pack-check') {
    const problems = packProblems(readFileSync(0, 'utf8'));
    if (problems.length) throw new Error(problems.join('\n'));
    console.error('The npm tarball contents look right.');
  } else {
    console.error('Usage: node scripts/release.ts notes <tag> | pack-check');
    process.exitCode = 2;
  }
}

if (import.meta.main) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
