import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { openDb } from '../src/core/db.ts';
import { facetsById, placeOf } from '../src/core/tag-place.ts';
import { listTagTree } from '../src/core/tag-tree.ts';
import type { Facet, TagNode } from '../src/types.ts';
import { addFile, db, home, native, setupMemoryDb, tagged } from './db-helpers.ts';
import { base } from './facets-helpers.ts';

setupMemoryDb();

const topic: Facet = { ...base, id: 'topic', kind: 'multi', open: true, values: {} };
const docType: Facet = { ...base, id: 'doc-type', kind: 'choice', values: { invoice: 'I.' } };
const signed: Facet = { ...base, id: 'signed', kind: 'flag' };
const FACETS = [topic, docType, signed];

/** The tree as `path direct/total` lines, indented by depth, so a test reads like the tree. */
function outline(nodes: TagNode[], indent = ''): string[] {
  return nodes.flatMap((node) => [
    `${indent}${node.path} ${node.direct}/${node.total}${node.implicit ? ' implicit' : ''}`,
    ...outline(node.children, `${indent}  `),
  ]);
}

const tree = (filter = {}) => listTagTree(db, FACETS, filter);

/** The tree of a fresh index whose tags were added one by one in this order, so their ids differ. */
function treeOf(tags: string[]): TagNode[] {
  const other = openDb(':memory:');
  const id = other.upsertFile(
    { path: '/lib/one', dev: '1', ino: '1', size: 1, mtime_ns: '1', ctime_ns: '1' },
    { edited: false },
  );
  for (const tag of tags) other.addFileTags(id, [tag], false);
  const result = listTagTree(other, FACETS);
  other.close();
  return result;
}

describe('the tree', () => {
  test('roots each facet, adds implicit parents, and counts direct and total files', () => {
    tagged('/lib/a', ['topic:finance/tax', 'topic:finance/tax/vat']);
    tagged('/lib/b', ['topic:finance/banking']);
    tagged('/lib/c', ['topic:finance/tax', 'doc-type:invoice']);
    expect(outline(tree())).toEqual([
      'doc-type: 0/1 implicit',
      '  doc-type:invoice 1/1',
      'topic: 0/3 implicit',
      '  topic:finance 0/3 implicit',
      '    topic:finance/banking 1/1',
      '    topic:finance/tax 2/2',
      '      topic:finance/tax/vat 1/1',
    ]);
  });

  test('a file carrying a parent and a child counts once in the total', () => {
    tagged('/lib/a', ['topic:finance', 'topic:finance/tax']);
    tagged('/lib/b', ['topic:finance']);
    const [root] = tree();
    expect(root!.children[0]).toMatchObject({ path: 'topic:finance', direct: 2, total: 2 });
  });

  test('plain tags make trees by "/", and an unknown prefix is plain', () => {
    tagged('/lib/a', ['year/2024', 'misc:thing']);
    tagged('/lib/b', ['year/2025']);
    expect(outline(tree())).toEqual([
      'misc:thing 1/1',
      'year 0/2 implicit',
      '  year/2024 1/1',
      '  year/2025 1/1',
    ]);
    expect(tree()[1]).toMatchObject({ facet: null, label: 'year', depth: 1, movable: true });
  });

  test('a flag tag is a leaf after the roots, and a closed facet does not move', () => {
    tagged('/lib/a', ['flag:signed', 'doc-type:invoice', 'topic:law', 'to-read']);
    const nodes = tree();
    expect(nodes.map((node) => node.path)).toEqual([
      'doc-type:',
      'topic:',
      'flag:signed',
      'to-read',
    ]);
    const movable = (path: string) =>
      [...nodes, ...nodes.flatMap((node) => node.children)].find((node) => node.path === path)
        ?.movable;
    expect(movable('doc-type:invoice')).toBe(false);
    expect(movable('flag:signed')).toBe(false);
    expect(movable('topic:')).toBe(false);
    expect(movable('topic:law')).toBe(true);
    expect(movable('to-read')).toBe(true);
  });

  test('labels and depths', () => {
    tagged('/lib/a', ['topic:a/b/c']);
    const [root] = tree();
    const c = root!.children[0]!.children[0]!.children[0]!;
    expect(root).toMatchObject({ label: 'topic', depth: 0, facet: 'topic' });
    expect(c).toMatchObject({ path: 'topic:a/b/c', label: 'c', depth: 3, implicit: false });
  });

  test('the order is the same whatever order the tags arrived in', () => {
    const tags = ['topic:z', 'topic:a/y', 'b', 'a/x', 'topic:a', 'doc-type:invoice', 'flag:signed'];
    const first = treeOf(tags);
    expect(treeOf(tags.toReversed())).toEqual(first);
    expect(first.map((node) => node.path)).toEqual([
      'doc-type:',
      'topic:',
      'flag:signed',
      'a',
      'b',
    ]);
    expect(first[1]!.children.map((node) => node.path)).toEqual(['topic:a', 'topic:z']);
  });

  test('facet keeps only that root, and folder counts only files under it', () => {
    tagged(native('/lib/in/a'), ['topic:x', 'plain']);
    tagged(native('/lib/out/b'), ['topic:x', 'topic:y']);
    expect(tree({ facet: 'topic' }).map((node) => node.path)).toEqual(['topic:']);
    const inside = tree({ folder: native('/lib/in') });
    expect(outline(inside)).toEqual(['topic: 0/1 implicit', '  topic:x 1/1', 'plain 1/1']);
  });

  test('an empty index has an empty tree', () => {
    addFile('/lib/untagged');
    expect(tree()).toEqual([]);
  });
});

describe('placeOf', () => {
  const known = facetsById(FACETS);
  test.each([
    ['topic:a/b', 'topic', 'a/b'],
    ['flag:signed', 'signed', null],
    ['topic:', null, 'topic:'],
    ['topic:/a', null, 'topic:/a'],
    ['flag:unknown', null, 'flag:unknown'],
  ])('%s', (tag, facet, label) => {
    const place = placeOf(tag, known);
    expect({ facet: place.facet?.id ?? null, label: place.label }).toEqual({ facet, label });
  });
});

describe('at scale', () => {
  const FILES = 100_000;
  const TAGS_PER_FILE = 5;

  /**
   * 2,000 tags: 1,000 topic leaves under 40 implicit parents, 500 parties, 300 plain tags under one
   * implicit parent and 200 flat plain tags. Seeded with SQL, as the public writes take minutes.
   */
  function seed(file: string): void {
    openDb(file).close();
    const raw = new DatabaseSync(file);
    raw.exec(`
      WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 1999)
      INSERT INTO tag (id, name) SELECT i + 1, CASE
        WHEN i < 1000 THEN 'topic:t' || (i / 25) || '/s' || (i % 25)
        WHEN i < 1500 THEN 'party:p' || i
        WHEN i < 1800 THEN 'misc/x' || i
        ELSE 'plain-' || i END FROM n;
      WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${FILES})
      INSERT INTO file (id, path, dev, ino, size, mtime_ns, ctime_ns)
        SELECT i, '/lib/f' || i, '1', i, 1, '1', '1' FROM n;
      WITH RECURSIVE k(j) AS (SELECT 0 UNION ALL SELECT j + 1 FROM k WHERE j < ${TAGS_PER_FILE - 1})
      INSERT OR IGNORE INTO file_tag (tag_id, file_id)
        SELECT ((f.id * 7 + k.j * 397) % 2000) + 1, f.id FROM file f, k;
    `);
    raw.close();
  }

  /** The seeded files carrying a tag id up to `last`, worked out from the seed's own formula. */
  function filesWithTagIdsUpTo(last: number): number {
    let files = 0;
    for (let id = 1; id <= FILES; id++) {
      const ids = Array.from({ length: TAGS_PER_FILE }, (_, j) => ((id * 7 + j * 397) % 2000) + 1);
      if (ids.some((tagId) => tagId <= last)) files++;
    }
    return files;
  }

  test('list_tag_tree stays quick at 100,000 files and 2,000 tags', () => {
    const file = join(home(), 'scale.db');
    seed(file);
    const large = openDb(file);
    const facets: Facet[] = [topic, { ...topic, id: 'party' }];
    listTagTree(large, facets); // warms the statement cache, as a running server has
    const timings: number[] = [];
    let nodes: TagNode[] = [];
    for (let run = 0; run < 3; run++) {
      const started = performance.now();
      nodes = listTagTree(large, facets);
      timings.push(performance.now() - started);
    }
    large.close();
    const median = timings.toSorted((left, right) => left - right)[1]!;
    console.log(`list_tag_tree: ${median.toFixed(0)} ms, the median of 3`);
    expect(nodes.map((node) => node.path).slice(0, 3)).toEqual(['party:', 'topic:', 'misc']);
    expect(nodes[1]!.children).toHaveLength(40);
    expect(nodes[1]!.total).toBe(filesWithTagIdsUpTo(1000));
    expect(median).toBeLessThan(2000); // 200 ms is the target; this bound holds under coverage
  }, 120_000);
});
