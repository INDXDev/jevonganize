/** Stored plans, the claim on a running apply, and the ops it has written. */
import type { Plan, PlanStatus, TagOp } from '../../types.ts';
import type { Sql } from './connection.ts';

/** Stores a plan, replacing any with its id. */
export function savePlan(sql: Sql, plan: Plan): void {
  sql.run(
    `INSERT INTO plan (id, body, status, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET body = excluded.body, status = excluded.status`,
    plan.id,
    JSON.stringify(plan),
    plan.status,
    plan.created_at,
  );
}

/** A plan with its ops. */
export function getPlan(sql: Sql, id: string): Plan | undefined {
  const row = sql.get<{ body: string }>('SELECT body FROM plan WHERE id = ?', id);
  return row && (JSON.parse(row.body) as Plan);
}

/** Plans, newest first, with `ops` empty, so a huge plan costs nothing to list. */
export function listPlans(sql: Sql, status?: PlanStatus): Plan[] {
  const filter = status === undefined ? '' : 'WHERE status = ?';
  return sql
    .all<{ body: string }>(
      `SELECT json_remove(body, '$.ops') AS body FROM plan ${filter}
       ORDER BY created_at DESC, id`,
      ...(status === undefined ? [] : [status]),
    )
    .map((row) => ({ ...(JSON.parse(row.body) as Omit<Plan, 'ops'>), ops: [] }));
}

/** Deletes a plan. */
export function deletePlan(sql: Sql, id: string): void {
  sql.run('DELETE FROM plan WHERE id = ?', id);
}

/** Moves a proposed plan to `applying`. One statement, so only one caller of any process wins. */
export function claimPlan(sql: Sql, id: string, now: number): boolean {
  const { changes } = sql.run(
    `UPDATE plan SET status = 'applying', claimed_at = ?,
       body = json_set(body, '$.status', 'applying')
     WHERE id = ? AND status = 'proposed'`,
    now,
    id,
  );
  return changes > 0;
}

/** Shows that the run holding a claim is alive. */
export function touchPlan(sql: Sql, id: string, now: number): void {
  sql.run('UPDATE plan SET claimed_at = ? WHERE id = ?', now, id);
}

/** Gives back claims with no sign of life since `before`. */
export function releasePlans(sql: Sql, before: number): void {
  sql.run(
    `UPDATE plan SET status = 'proposed', body = json_set(body, '$.status', 'proposed')
     WHERE status = 'applying' AND claimed_at < ?`,
    before,
  );
}

/** Records one op a running apply has written, apart from the plan so the cost stays flat. */
export function addPlanOp(sql: Sql, planId: string, op: TagOp): void {
  sql.run(
    'INSERT OR REPLACE INTO plan_op (plan_id, file_id, body) VALUES (?, ?, ?)',
    planId,
    op.file_id,
    JSON.stringify(op),
  );
}

/** The ops an unfinished apply has written. */
export function planOps(sql: Sql, planId: string): TagOp[] {
  return sql
    .all<{ body: string }>('SELECT body FROM plan_op WHERE plan_id = ?', planId)
    .map((row) => JSON.parse(row.body) as TagOp);
}

/** Forgets those ops, once the plan holds them. */
export function clearPlanOps(sql: Sql, planId: string): void {
  sql.run('DELETE FROM plan_op WHERE plan_id = ?', planId);
}
