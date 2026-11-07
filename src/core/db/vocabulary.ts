/** The values of open facets. */
import type { Sql } from './connection.ts';

/** Where a value of an open facet stands. */
export type VocabularyState = 'proposed' | 'active' | 'retired';

/** Sets a value's state, adding it if new. */
export function setVocabulary(
  sql: Sql,
  facet: string,
  value: string,
  state: VocabularyState,
): void {
  sql.run(
    `INSERT INTO vocabulary (facet, value, state) VALUES (?, ?, ?)
     ON CONFLICT (facet, value) DO UPDATE SET state = excluded.state`,
    facet,
    value,
    state,
  );
}

/** Forgets a value, as if it had never been suggested. */
export function deleteVocabulary(sql: Sql, facet: string, value: string): void {
  sql.run('DELETE FROM vocabulary WHERE facet = ? AND value = ?', facet, value);
}

/** Adds a suggested value. One already active or retired stays as it is. */
export function proposeVocabulary(sql: Sql, facet: string, value: string): void {
  sql.run(
    `INSERT OR IGNORE INTO vocabulary (facet, value, state) VALUES (?, ?, 'proposed')`,
    facet,
    value,
  );
}

/** Open-facet values, optionally for one facet. */
export function listVocabulary(sql: Sql, facet?: string) {
  const filter = facet === undefined ? '' : 'WHERE facet = ?';
  return sql.all<{ facet: string; value: string; state: VocabularyState }>(
    `SELECT facet, value, state FROM vocabulary ${filter} ORDER BY facet, value`,
    ...(facet === undefined ? [] : [facet]),
  );
}
