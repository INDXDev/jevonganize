/** The SQLite connection every part of the index shares: cached statements and transactions. */
import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue, StatementSync } from 'node:sqlite';

const BUSY_TIMEOUT_MS = 5000;

/** A connection, as the query modules see it. */
export type Sql = ReturnType<typeof connect>;

/** Opens the file. Statements are prepared once per connection. */
export function connect(location: string) {
  const raw = new DatabaseSync(location, { timeout: BUSY_TIMEOUT_MS });
  const statements = new Map<string, StatementSync>();

  function prepared(sql: string): StatementSync {
    let statement = statements.get(sql);
    if (!statement) statements.set(sql, (statement = raw.prepare(sql)));
    return statement;
  }

  /**
   * Runs `work` in one write transaction, joining any already open. It must be synchronous: on a
   * shared connection, an `await` here would pull other callers' writes into the transaction.
   */
  function transaction<T>(work: () => T): T {
    if (raw.isTransaction) return work();
    raw.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      raw.exec('COMMIT');
      return result;
    } catch (error) {
      raw.exec('ROLLBACK');
      throw error;
    }
  }

  return {
    all: <T>(sql: string, ...params: SQLInputValue[]) =>
      prepared(sql).all(...params) as unknown as T[],
    // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- names the row type at each call site
    get: <T>(sql: string, ...params: SQLInputValue[]) =>
      prepared(sql).get(...params) as unknown as T | undefined,
    run: (sql: string, ...params: SQLInputValue[]) => prepared(sql).run(...params),
    exec: (sql: string) => raw.exec(sql),
    transaction,
    close: () => raw.close(),
  };
}
