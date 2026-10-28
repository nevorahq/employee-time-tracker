import type { Statement } from 'better-sqlite3';
import type { Db } from '../db/open.ts';

export type TimeEntryRecord = {
  id: string;
  employeeId: string;
  employeeName: string;
  description: string;
  startedAt: number;
  endedAt: number | null;
};

export type NewActiveEntry = {
  id: string;
  employeeId: string;
  description: string;
  startedAt: number;
  createdAt: number;
};

/**
 * Entries that intersect [from, to). Active entries are treated as ending at `evaluatedAt`.
 * History and reports share this predicate (FR-HIS-4). Every bound is optional.
 */
export type OverlapFilter = { employeeId?: string; from?: number; to?: number; evaluatedAt: number };

type Row = {
  id: string;
  employee_id: string;
  employee_name: string;
  description: string;
  started_at: number;
  ended_at: number | null;
};

const toRecord = (r: Row): TimeEntryRecord => ({
  id: r.id,
  employeeId: r.employee_id,
  employeeName: r.employee_name,
  description: r.description,
  startedAt: r.started_at,
  endedAt: r.ended_at,
});

const SELECT_JOINED = `
  SELECT t.id, t.employee_id, e.name AS employee_name, t.description, t.started_at, t.ended_at
  FROM time_entries t JOIN employees e ON e.id = t.employee_id`;

/** Builds a WHERE clause from fixed fragments only; every value is bound as a parameter (DB-5). */
function overlapWhere(f: OverlapFilter): { where: string; params: Record<string, string | number> } {
  const conds: string[] = [];
  const params: Record<string, string | number> = {};
  if (f.employeeId !== undefined) {
    conds.push('t.employee_id = @employeeId');
    params.employeeId = f.employeeId;
  }
  if (f.to !== undefined) {
    conds.push('t.started_at < @to');
    params.to = f.to;
  }
  if (f.from !== undefined) {
    conds.push('COALESCE(t.ended_at, @evaluatedAt) > @from');
    params.from = f.from;
    params.evaluatedAt = f.evaluatedAt;
  }
  return { where: conds.length ? `WHERE ${conds.join(' AND ')}` : '', params };
}

export function createTimeEntryRepo(db: Db) {
  const cache = new Map<string, Statement>();
  const prepare = (sql: string): Statement => {
    let stmt = cache.get(sql);
    if (!stmt) {
      stmt = db.prepare(sql);
      cache.set(sql, stmt);
    }
    return stmt;
  };

  const insertActive = db.prepare(`
    INSERT INTO time_entries (id, employee_id, description, started_at, ended_at, created_at)
    VALUES (@id, @employeeId, @description, @startedAt, NULL, @createdAt)`);
  const byId = db.prepare(`${SELECT_JOINED} WHERE t.id = ?`);
  // Compare-and-set: only an entry that is still active can be stopped (BR-5).
  // max() keeps `ended_at >= started_at` if the system clock moved backwards (FR-TMR-10).
  const stop = db.prepare(
    `UPDATE time_entries SET ended_at = max(@endedAt, started_at)
     WHERE id = @id AND ended_at IS NULL RETURNING id`,
  );

  const findById = (id: string): TimeEntryRecord | undefined => {
    const row = byId.get(id) as Row | undefined;
    return row && toRecord(row);
  };

  return {
    findById,

    /** Throws SQLITE_CONSTRAINT_UNIQUE if the employee already has an active entry. */
    insertActive(e: NewActiveEntry): TimeEntryRecord {
      insertActive.run(e);
      return findById(e.id) as TimeEntryRecord;
    },

    /** Returns the stopped entry, or undefined if it does not exist or was already stopped. */
    stopActive(id: string, endedAt: number): TimeEntryRecord | undefined {
      if (stop.get({ id, endedAt }) === undefined) return undefined;
      return findById(id);
    },

    listActive(employeeId?: string): TimeEntryRecord[] {
      const sql =
        employeeId === undefined
          ? `${SELECT_JOINED} WHERE t.ended_at IS NULL ORDER BY t.started_at, t.id`
          : `${SELECT_JOINED} WHERE t.ended_at IS NULL AND t.employee_id = @employeeId ORDER BY t.started_at, t.id`;
      return (prepare(sql).all(employeeId === undefined ? {} : { employeeId }) as Row[]).map(toRecord);
    },

    /** Newest first, paged (FR-HIS-5). */
    findOverlapping(f: OverlapFilter, page?: { limit: number; offset: number }): TimeEntryRecord[] {
      const { where, params } = overlapWhere(f);
      const paging = page ? ' LIMIT @limit OFFSET @offset' : '';
      const sql = `${SELECT_JOINED} ${where} ORDER BY t.started_at DESC, t.id${paging}`;
      return (prepare(sql).all(page ? { ...params, ...page } : params) as Row[]).map(toRecord);
    },

    countOverlapping(f: OverlapFilter): number {
      const { where, params } = overlapWhere(f);
      const sql = `SELECT COUNT(*) AS n FROM time_entries t ${where}`;
      return (prepare(sql).get(params) as { n: number }).n;
    },
  };
}

export type TimeEntryRepo = ReturnType<typeof createTimeEntryRepo>;
