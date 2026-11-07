/** Virtual folders: saved rules over tags. Rows only; `core/vfolders.ts` checks what they hold. */
import type { Tag } from '../../types.ts';
import type { Sql } from './connection.ts';

/** A `vfolder` row, with its rule still as stored JSON. */
export interface VirtualFolderRow {
  id: number;
  name: string;
  parent: number | null;
  rule: string;
  tag: Tag | null;
  created_at: number;
}

/** What a new or changed folder stores. */
export type VirtualFolderValues = Omit<VirtualFolderRow, 'id' | 'created_at'>;

/** Every folder, parents before nothing in particular: callers build the tree. */
export function listVfolders(sql: Sql): VirtualFolderRow[] {
  return sql.all<VirtualFolderRow>(
    'SELECT id, name, parent, rule, tag, created_at FROM vfolder ORDER BY name COLLATE NOCASE, id',
  );
}

/** One folder, if it exists. */
export function getVfolder(sql: Sql, id: number): VirtualFolderRow | undefined {
  return sql.get<VirtualFolderRow>(
    'SELECT id, name, parent, rule, tag, created_at FROM vfolder WHERE id = ?',
    id,
  );
}

/** The id of the folder with this name under this parent, if any. */
export function vfolderNamed(sql: Sql, name: string, parent: number | null): number | undefined {
  return sql.get<{ id: number }>(
    'SELECT id FROM vfolder WHERE name = ? AND parent IS ?',
    name,
    parent,
  )?.id;
}

/** Stores a new folder and returns its id. */
export function insertVfolder(sql: Sql, values: VirtualFolderValues, createdAt: number): number {
  const { name, parent, rule, tag } = values;
  return sql.get<{ id: number }>(
    `INSERT INTO vfolder (name, parent, rule, tag, created_at) VALUES (?, ?, ?, ?, ?)
     RETURNING id`,
    name,
    parent,
    rule,
    tag,
    createdAt,
  )!.id;
}

/** Replaces what a folder stores. Its id and creation time stay. */
export function updateVfolder(sql: Sql, id: number, values: VirtualFolderValues): void {
  const { name, parent, rule, tag } = values;
  sql.run(
    'UPDATE vfolder SET name = ?, parent = ?, rule = ?, tag = ? WHERE id = ?',
    name,
    parent,
    rule,
    tag,
    id,
  );
}

/**
 * Deletes a folder and every folder under it, and returns how many went. The connection does not
 * turn on `foreign_keys`, so the cascade is spelled out rather than left to the schema.
 */
export function deleteVfolder(sql: Sql, id: number): number {
  const { changes } = sql.run(
    `DELETE FROM vfolder WHERE id IN (WITH RECURSIVE sub(id) AS
       (SELECT ? UNION SELECT v.id FROM vfolder v JOIN sub ON v.parent = sub.id) SELECT id FROM sub)`,
    id,
  );
  return Number(changes);
}
