/**
 * The tag mirror: the index's copy of the tags on disk, and the weights similarity reads. A file's
 * `tag_w` is the sum of `idf * weight` over its tags, the denominator half of weighted Jaccard.
 */
import type { Tag, TagCount } from '../../types.ts';
import type { Sql } from './connection.ts';
import { folderRange } from './paths.ts';
import type { Clause } from './tag-filter.ts';

/** A tag in the mirror, and whether the app wrote it. */
export interface MirrorTag {
  tag: Tag;
  ai: boolean;
}

/** The summed tag weight of the `file` row in scope, or 0 for a file with no tags. */
const FILE_TAG_WEIGHT = `coalesce((SELECT sum(t.idf * t.weight) FROM file_tag ft
  JOIN tag t ON t.id = ft.tag_id WHERE ft.file_id = file.id), 0)`;

/** The id of a tag by name, as a subquery with one placeholder. */
const TAG_ID_BY_NAME = '(SELECT id FROM tag WHERE name = ?)';

/** The mirror for one file, sorted. */
export function fileTags(sql: Sql, fileId: number): MirrorTag[] {
  const rows = sql.all<{ tag: Tag; ai: number }>(
    `SELECT t.name AS tag, ft.ai FROM file_tag ft JOIN tag t ON t.id = ft.tag_id
     WHERE ft.file_id = ? ORDER BY t.name`,
    fileId,
  );
  return rows.map(({ tag, ai }) => ({ tag, ai: ai === 1 }));
}

/** Keeps `tag_w` right for one file, using the current `idf`. */
function updateFileWeight(sql: Sql, fileId: number): void {
  sql.run(`UPDATE file SET tag_w = ${FILE_TAG_WEIGHT} WHERE id = ?`, fileId);
}

/** The id of the `tag` row for a name, creating the row if it is new. */
function upsertTagId(sql: Sql, tag: Tag): number {
  // A no-op update, so RETURNING gives the id of an existing row too.
  const row = sql.get<{ id: number }>(
    `INSERT INTO tag (name) VALUES (?)
     ON CONFLICT (name) DO UPDATE SET name = excluded.name RETURNING id`,
    tag,
  );
  return row!.id;
}

/** Adds tags to the mirror, setting `ai` on each. Keeps `tag_w` right. */
export function addFileTags(sql: Sql, fileId: number, tags: Tag[], writtenByApp: boolean): void {
  if (tags.length === 0) return;
  sql.transaction(() => {
    for (const tag of tags) {
      sql.run(
        `INSERT INTO file_tag (tag_id, file_id, ai) VALUES (?, ?, ?)
         ON CONFLICT (tag_id, file_id) DO UPDATE SET ai = excluded.ai`,
        upsertTagId(sql, tag),
        fileId,
        writtenByApp ? 1 : 0,
      );
    }
    updateFileWeight(sql, fileId);
  });
}

/** Removes tags from the mirror. Keeps `tag_w` right. */
export function removeFileTags(sql: Sql, fileId: number, tags: Tag[]): void {
  if (tags.length === 0) return;
  sql.transaction(() => {
    for (const tag of tags) {
      sql.run(`DELETE FROM file_tag WHERE file_id = ? AND tag_id = ${TAG_ID_BY_NAME}`, fileId, tag);
    }
    updateFileWeight(sql, fileId);
  });
}

/**
 * Makes the mirror equal the disk. A tag that stays keeps its `ai` flag, and a new one is human.
 * Returns the difference, so a scan can tell what a person removed.
 */
export function syncFileTags(
  sql: Sql,
  fileId: number,
  diskTags: Tag[],
): { added: Tag[]; removed: MirrorTag[] } {
  const mirrored = fileTags(sql, fileId);
  const mirroredNames = new Set(mirrored.map((row) => row.tag));
  const onDisk = new Set(diskTags);
  const added = diskTags.filter((tag) => !mirroredNames.has(tag));
  const removed = mirrored.filter((row) => !onDisk.has(row.tag));
  const unchanged = added.length === 0 && removed.length === 0;
  if (unchanged) return { added, removed };
  sql.transaction(() => {
    removeFileTags(
      sql,
      fileId,
      removed.map((row) => row.tag),
    );
    addFileTags(sql, fileId, added, false);
  });
  return { added, removed };
}

/** Ids of files carrying exactly this tag, children excluded. */
export function filesWithTag(sql: Sql, tag: Tag): number[] {
  const rows = sql.all<{ file_id: number }>(
    `SELECT file_id FROM file_tag WHERE tag_id = ${TAG_ID_BY_NAME}`,
    tag,
  );
  return rows.map((row) => row.file_id);
}

/** What `tagCounts` can narrow to. */
interface TagCountFilter {
  folder?: string;
  facet?: string;
}

/** The conditions of a `tagCounts` filter, in the order of their placeholders. */
function tagCountConditions({ folder, facet }: TagCountFilter): Clause[] {
  const inFolder = folder
    ? { sql: 'f.path >= ? AND f.path < ?', params: folderRange(folder) }
    : null;
  const ofFacet = facet ? { sql: 't.facet = ?', params: [facet] } : null;
  return [inFolder, ofFacet].filter((clause) => clause !== null);
}

/** Tags in use, most used first, optionally within a folder or a facet. */
export function tagCounts(sql: Sql, filter: TagCountFilter = {}): TagCount[] {
  const conditions = tagCountConditions(filter);
  const where = ['1', ...conditions.map((clause) => clause.sql)].join(' AND ');
  // Joining `file` costs a lookup per tag row, so it is only added for a folder filter.
  const fileJoin = filter.folder ? 'JOIN file f ON f.id = ft.file_id' : '';
  return sql.all(
    `SELECT t.name AS tag, t.facet, count(*) AS count FROM file_tag ft
     JOIN tag t ON t.id = ft.tag_id ${fileJoin}
     WHERE ${where} GROUP BY t.id ORDER BY count DESC, t.name`,
    ...conditions.flatMap((clause) => clause.params),
  );
}

/**
 * Stamps each tag with its facet and similarity weight. Only a caller holding the facets knows
 * which prefixes are facets, so run this after loading them and before `refreshIdf`.
 */
export function setTagFacets(sql: Sql, facets: { id: string; weight: number }[]): void {
  sql.transaction(() => {
    for (const { id, weight } of facets) {
      // Every `id:...` name sorts in [`id:`, `id;`), since `;` is the character right after `:`.
      const namespaceStart = `${id}:`;
      const namespaceEnd = `${id};`;
      const flagTag = `flag:${id}`;
      // Only rows that change, so the schema's triggers do not mark similarity dirty for nothing.
      sql.run(
        `UPDATE tag SET facet = ?, weight = ? WHERE ((name >= ? AND name < ?) OR name = ?)
         AND (facet IS NOT ? OR weight <> ?)`,
        id,
        weight,
        namespaceStart,
        namespaceEnd,
        flagTag,
        id,
        weight,
      );
    }
  });
}

/** Rebuilds dirty similarity weights atomically; returns false when nothing changed. */
export function refreshIdf(sql: Sql): boolean {
  return sql.transaction(() => {
    // Triggers in the schema set `dirty` when a file, a file's tags or a tag's weight changes.
    const { dirty } = sql.get<{ dirty: number }>(
      'SELECT dirty FROM similarity_state WHERE id = 1',
    )!;
    if (!dirty) return false;
    const { fileCount } = sql.get<{ fileCount: number }>('SELECT count(*) AS fileCount FROM file')!;
    sql.run('UPDATE tag SET df = (SELECT count(*) FROM file_tag WHERE tag_id = tag.id)');
    // BM25's IDF: always positive, so even a tag on every file adds a little weight.
    sql.run('UPDATE tag SET idf = ln(1 + (? - df + 0.5) / (df + 0.5))', fileCount);
    sql.run(`UPDATE file SET tag_w = ${FILE_TAG_WEIGHT}`);
    sql.run('UPDATE similarity_state SET dirty = 0 WHERE id = 1');
    return true;
  });
}
