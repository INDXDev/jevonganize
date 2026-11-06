/** Cached model answers, and which of them each file uses. */
import type { Answer } from '../../types.ts';
import type { Sql } from './connection.ts';

function parseAnswers(body: string): Answer[] | undefined {
  try {
    const answers: unknown = JSON.parse(body);
    return Array.isArray(answers) ? (answers as Answer[]) : undefined;
  } catch {
    return undefined; // a damaged row counts as a miss
  }
}

/** Stores raw answers. Two processes racing on a key is fine: the first one stays. */
export function putAnswer(sql: Sql, key: string, facet: string, answers: Answer[]): void {
  sql.run(
    'INSERT OR REPLACE INTO answer (key, facet, body, created_at) VALUES (?, ?, ?, ?)',
    key,
    facet,
    JSON.stringify(answers),
    Date.now(),
  );
}

/** The cached answers for a key. A missing or damaged row is `undefined`. */
export function getAnswer(sql: Sql, key: string): Answer[] | undefined {
  const row = sql.get<{ body: string }>('SELECT body FROM answer WHERE key = ?', key);
  return row && parseAnswers(row.body);
}

/** The rows of many keys in one query, for a loop that would otherwise read them one by one. */
export function getAnswers(sql: Sql, keys: string[]): Map<string, Answer[]> {
  const rows = sql.all<{ key: string; body: string }>(
    'SELECT key, body FROM answer WHERE key IN (SELECT value FROM json_each(?))',
    JSON.stringify(keys),
  );
  return new Map(
    rows.flatMap(({ key, body }) => {
      const answers = parseAnswers(body);
      return answers ? [[key, answers]] : [];
    }),
  );
}

/** Records which answer a file uses for a facet. */
export function linkAnswer(sql: Sql, fileId: number, facet: string, key: string): void {
  sql.run(
    `INSERT INTO file_answer (file_id, facet, key) VALUES (?, ?, ?)
     ON CONFLICT (file_id, facet) DO UPDATE SET key = excluded.key`,
    fileId,
    facet,
    key,
  );
}

/** Every answer a file uses, across facets. */
export function fileAnswers(sql: Sql, fileId: number): Answer[] {
  return sql
    .all<{ body: string }>(
      `SELECT a.body FROM file_answer fa JOIN answer a ON a.key = fa.key
       WHERE fa.file_id = ? ORDER BY fa.facet`,
      fileId,
    )
    .flatMap(({ body }) => parseAnswers(body) ?? []);
}
