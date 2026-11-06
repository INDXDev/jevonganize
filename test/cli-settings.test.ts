import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { readTags } from '../src/core/tags.ts';
import { cli, home, lines, root, setupCliHome } from './cli-helpers.ts';

setupCliHome();

describe('settings', () => {
  test('config set parses TOML, validates, and get reads it back', async () => {
    expect((await cli(['config', 'set', 'thresholds.apply', '0.9'])).stdout).toBe(
      'thresholds.apply = 0.9\n',
    );
    expect((await cli(['config', 'get', 'thresholds.apply'])).stdout).toBe('0.9\n');
    await cli(['config', 'set', 'exclude', '["a", "b"]']);
    expect((await cli(['config', 'get', 'exclude'])).stdout).toContain('"a"');
    expect((await cli(['config', 'set', 'nope', '1'])).code).toBe(2);
    expect((await cli(['config', 'get', 'nope'])).code).toBe(2);
    const json = JSON.parse((await cli(['config', 'get', '--json'])).stdout) as object;
    expect(json).toHaveProperty('schema');
  });

  test('config edit saves a valid file and never an invalid one', async () => {
    const script = join(home(), 'edit.mjs');
    const write = `import { writeFileSync as w } from 'node:fs'; w(process.argv[2], process.env.CONTENT);`;
    await writeFile(script, write);
    const editor = `${process.execPath} ${script}`; // Node, as Windows cannot run a shell script
    const good = await cli(['config', 'edit'], {
      env: { VISUAL: editor, CONTENT: 'concurrency = 3\n' },
    });
    expect(good.code).toBe(0);
    const bad = await cli(['config', 'edit'], { env: { VISUAL: editor, CONTENT: 'nope = 3\n' } });
    expect(bad.code).toBe(2);
    expect((await cli(['config', 'get', 'concurrency'])).stdout).toBe('3\n');
  });

  test('config path prints three paths inside the home', async () => {
    const paths = lines((await cli(['config', 'path'])).stdout);
    expect(paths).toHaveLength(3);
    for (const path of paths) expect(path.startsWith(home())).toBe(true);
  });
});

describe('keys, facets and checks', () => {
  test('auth stores from a pipe, never prints the key, and env consent is explicit', async () => {
    await cli(['auth', 'set', 'openai'], { stdin: 'sk-secret\n' });
    const listed = await cli(['auth', 'list']);
    expect(listed.stdout).toMatch(/openai\s+file/);
    expect(listed.stdout).not.toContain('sk-secret');
    const env = { TYPESAFE_AI_API_KEY: 'from-env' };
    expect((await cli(['auth', 'list'], { env })).stdout).toMatch(/typesafe\s+none/);
    await cli(['auth', 'env', 'on']);
    expect((await cli(['auth', 'list'], { env })).stdout).toMatch(/typesafe\s+env/);
    expect((await cli(['auth', 'env', 'maybe'])).code).toBe(2);
    expect((await cli(['auth', 'remove', 'openai'])).stdout).toContain('Removed');
    expect((await cli(['auth', 'set', 'nobody'], { stdin: 'k' })).code).toBe(2);
  });

  test('facets list, show, enable and disable', async () => {
    expect((await cli(['facets', 'list'])).stdout).toMatch(/\* core/);
    expect((await cli(['facets', 'show', 'visibility'])).stdout).toContain('public');
    expect((await cli(['facets', 'show', 'nope'])).code).toBe(2);
    await cli(['facets', 'enable', 'finance']);
    expect((await cli(['facets', 'list'])).stdout).toMatch(/\* finance/);
    await cli(['facets', 'disable', 'finance']);
    expect((await cli(['facets', 'list'])).stdout).toMatch(/ {2}finance/);
  });

  test('doctor exits 1 when a required check fails', async () => {
    const failing = await cli(['doctor']);
    expect(failing.code).toBe(1);
    expect(failing.stdout).toContain('FAIL');
    await cli(['auth', 'set', 'openai'], { stdin: 'k' });
    expect((await cli(['doctor', '--json'])).code).toBe(0);
  });

  test('cleanup and review print nothing to do on an empty index', async () => {
    expect((await cli(['cleanup'])).code).toBe(0);
    expect((await cli(['review'])).stdout).toBe('');
    expect((await cli(['review', '--accept', 'all'])).code).toBe(2);
    expect((await cli(['review', '--accept', '1', '--reject', '2'])).code).toBe(2);
  });
});

describe('setup', () => {
  test('--yes needs --folder, and a terminal is needed without it', async () => {
    expect((await cli(['setup', '--yes'])).code).toBe(2);
    const piped = await cli(['setup']);
    expect(piped.code).toBe(2);
    expect(piped.stderr).toContain('terminal');
  });

  test('--yes needs a key stored or piped', async () => {
    const { code, stderr } = await cli(['setup', '--yes', '--folder', root]);
    expect(code).toBe(2);
    expect(stderr).toContain('No key');
  });

  test('--yes takes a piped key, adds, enables, scans, and writes no tags', async () => {
    const path = join(root, 'a.txt');
    await writeFile(path, 'hello');
    const { code, stdout } = await cli(
      ['setup', '--yes', '--folder', root, '--packs', 'core,finance'],
      { stdin: 'sk-test' },
    );
    expect(code).toBe(0);
    expect(stdout).toContain('Scanned 1 files in');
    expect(stdout).toContain('Next: jevonganize organize');
    expect(await readTags(path)).toEqual([]);
    expect((await cli(['auth', 'list'])).stdout).toMatch(/openai\s+file/);
    const list = (await cli(['facets', 'list'])).stdout;
    expect(list).toMatch(/\* finance/);
    expect(list).toMatch(/ {2}time/);
  });
});

test('ask with no key refuses with exit 2', async () => {
  const { code, stderr } = await cli(['ask', 'hello']);
  expect(code).toBe(2);
  expect(stderr).toContain('API key');
});
