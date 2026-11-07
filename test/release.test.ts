import { describe, expect, it } from 'vitest';
import { changelogSection, checkTag, installNotes, packProblems } from '../scripts/release.ts';

const changelog = `# Changelog

## Unreleased

- Next thing.

## 0.2.0 - 2026-12-01

- Second.

## 0.1.0

- First.
`;

describe('checkTag', () => {
  it('accepts v plus the package version', () => {
    expect(checkTag('v0.1.0', '0.1.0')).toBe('0.1.0');
    expect(checkTag('refs/tags/v1.2.3', '1.2.3')).toBe('1.2.3');
  });

  it('refuses a mismatch, a missing v and pre-releases', () => {
    expect(() => checkTag('v0.1.1', '0.1.0')).toThrow(/does not match/);
    expect(() => checkTag('0.1.0', '0.1.0')).toThrow(/vX\.Y\.Z/);
    expect(() => checkTag('v0.1.0-beta.1', '0.1.0-beta.1')).toThrow(/vX\.Y\.Z/);
  });
});

describe('changelogSection', () => {
  it('returns one section, with or without a date', () => {
    expect(changelogSection(changelog, '0.2.0')).toBe('- Second.');
    expect(changelogSection(changelog, '0.1.0')).toBe('- First.');
  });

  it('refuses a missing or empty section', () => {
    expect(() => changelogSection(changelog, '0.3.0')).toThrow(/no "## 0.3.0"/);
    expect(() => changelogSection('## 1.0.0\n\n## 0.9.0\n- x', '1.0.0')).toThrow(/empty/);
  });

  it('does not match a longer version', () => {
    expect(() => changelogSection('## 0.1.01\n- x', '0.1.0')).toThrow(/no "## 0.1.0"/);
  });
});

const listing = (paths: string[]) => JSON.stringify([{ files: paths.map((path) => ({ path })) }]);

describe('packProblems', () => {
  const good = [
    'package.json',
    'dist/cli.mjs',
    'dist/web/index.html',
    'presets/core.toml',
    'LICENSE',
  ];

  it('passes a complete tarball', () => {
    expect(packProblems(listing(good))).toEqual([]);
  });

  it('names missing and forbidden paths', () => {
    expect(packProblems(listing([...good.slice(1), 'src/cli.ts', 'dist/cli.mjs.map']))).toEqual([
      'Missing: package.json',
      'Must not be published: src/cli.ts',
      'Must not be published: dist/cli.mjs.map',
    ]);
  });
});

describe('installNotes', () => {
  it('links each desktop file on the tag', () => {
    const notes = installNotes('v0.1.0');
    expect(notes).toContain(
      'https://github.com/INDXDev/jevonganize/releases/download/v0.1.0/Jevonganize-macOS-arm64.dmg',
    );
    expect(notes).toContain('/v0.1.0/Jevonganize-Windows-x64-Setup.exe');
    expect(notes).toContain('/v0.1.0/Jevonganize-Linux-x64.AppImage');
  });
});
