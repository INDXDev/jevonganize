/** The oldest Node.js allowed. It parses hostile files, so unpatched releases are refused. */

/** Keep in step with `engines` in package.json. */
export const NODE_FLOOR = '24.22.1, or 26.12.1 and later';

/** True for `^24.22.1 || >=26.12.1`. */
export function nodeSupported(version: string): boolean {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number);
  const atLeast = (m: number, p: number) => minor > m || (minor === m && patch >= p);
  if (major === 24) return atLeast(22, 1);
  if (major === 26) return atLeast(12, 1);
  return major > 26;
}
