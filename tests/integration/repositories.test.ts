import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/server/db/open.ts';
import { createEmployeeRepo } from '../../src/server/repositories/employees.ts';
import { createTimeEntryRepo } from '../../src/server/repositories/timeEntries.ts';
import { sqliteCode } from '../../src/server/db/sqlite-errors.ts';
import { tmpDbPath } from '../helpers/db.ts';

function setup() {
  const db = openDatabase(tmpDbPath());
  const employees = createEmployeeRepo(db);
  const entries = createTimeEntryRepo(db);
  employees.insert({ id: 'e1', name: 'Ada Example', createdAt: 1 });
  employees.insert({ id: 'e2', name: 'Bob Sample', createdAt: 1 });
  let n = 0;
  const start = (employeeId: string, startedAt: number, endedAt: number | null = null) => {
    const id = `t${++n}`;
    entries.insertActive({ id, employeeId, description: `task ${id}`, startedAt, createdAt: startedAt });
    if (endedAt !== null) entries.stopActive(id, endedAt);
    return id;
  };
  return { db, employees, entries, start };
}

describe('employee repository', () => {
  it('lists employees by name, case-insensitively, and keeps duplicate names', () => {
    const { employees } = setup();
    employees.insert({ id: 'e3', name: 'alice', createdAt: 1 });
    employees.insert({ id: 'e4', name: 'Alice', createdAt: 2 });
    employees.insert({ id: 'e5', name: 'Zed', createdAt: 3 });
    expect(employees.list().map((e) => e.name)).toEqual(['Ada Example', 'Alice', 'alice', 'Bob Sample', 'Zed']);
  });

  it('knows which employees exist', () => {
    const { employees } = setup();
    expect(employees.exists('e1')).toBe(true);
    expect(employees.exists('nope')).toBe(false);
  });
});

describe('time entry repository', () => {
  it('inserts an active entry with the employee name', () => {
    const { entries } = setup();
    const e = entries.insertActive({ id: 't1', employeeId: 'e1', description: 'Write report', startedAt: 1000, createdAt: 1000 });
    expect(e).toEqual({
      id: 't1',
      employeeId: 'e1',
      employeeName: 'Ada Example',
      description: 'Write report',
      startedAt: 1000,
      endedAt: null,
    });
  });

  it('refuses a second active entry for the same employee', () => {
    const { entries, start } = setup();
    start('e1', 1000);
    try {
      entries.insertActive({ id: 'dup', employeeId: 'e1', description: 'again', startedAt: 2000, createdAt: 2000 });
      throw new Error('expected a constraint error');
    } catch (err) {
      expect(sqliteCode(err)).toBe('SQLITE_CONSTRAINT_UNIQUE');
    }
  });

  it('stops an active entry exactly once (compare-and-set)', () => {
    const { entries, start } = setup();
    const id = start('e1', 1000);
    expect(entries.stopActive(id, 5000)?.endedAt).toBe(5000);
    expect(entries.stopActive(id, 9000)).toBeUndefined();
    expect(entries.findById(id)?.endedAt).toBe(5000);
    expect(entries.stopActive('missing', 9000)).toBeUndefined();
  });

  it('never stores an end before the start when the clock moved backwards (FR-TMR-10)', () => {
    const { entries, start } = setup();
    const id = start('e1', 10_000);
    expect(entries.stopActive(id, 4_000)?.endedAt).toBe(10_000);
  });

  it('lists active entries, optionally for one employee', () => {
    const { entries, start } = setup();
    start('e1', 1000, 2000);
    start('e1', 3000);
    start('e2', 2500);
    expect(entries.listActive().map((e) => e.employeeId)).toEqual(['e2', 'e1']);
    expect(entries.listActive('e1')).toHaveLength(1);
    expect(entries.listActive('nobody')).toEqual([]);
  });

  describe('findOverlapping / countOverlapping', () => {
    it('uses the half-open [from, to) predicate', () => {
      const { entries, start } = setup();
      const ends = start('e1', 100, 1000); // ends exactly at from
      const starts = start('e1', 2000, 3000); // starts exactly at to
      const inside = start('e1', 1000, 1500);
      const crossing = start('e2', 1900, 2100);
      const f = { from: 1000, to: 2000, evaluatedAt: 9999 };
      const ids = entries.findOverlapping(f).map((e) => e.id);
      expect(ids).toEqual([crossing, inside]); // newest first
      expect(ids).not.toContain(ends);
      expect(ids).not.toContain(starts);
      expect(entries.countOverlapping(f)).toBe(2);
    });

    it('treats an active entry as ending at evaluatedAt', () => {
      const { entries, start } = setup();
      const active = start('e1', 500);
      expect(entries.findOverlapping({ from: 1000, to: 2000, evaluatedAt: 1600 }).map((e) => e.id)).toEqual([active]);
      // evaluated exactly at `from`: the entry ends where the period starts, so it does not overlap
      expect(entries.findOverlapping({ from: 1000, to: 2000, evaluatedAt: 1000 })).toEqual([]);
    });

    it('filters by employee and pages the results', () => {
      const { entries, start } = setup();
      for (let i = 0; i < 5; i++) start('e1', 1000 + i * 10, 1005 + i * 10);
      start('e2', 1000, 1005);
      const f = { employeeId: 'e1', evaluatedAt: 9999 };
      expect(entries.countOverlapping(f)).toBe(5);
      const page = entries.findOverlapping(f, { limit: 2, offset: 1 });
      expect(page.map((e) => e.startedAt)).toEqual([1030, 1020]);
      expect(entries.findOverlapping({ evaluatedAt: 9999 })).toHaveLength(6);
    });
  });

  it('uses an index for the per-employee history query (NFR-10)', () => {
    const { db } = setup();
    const plan = db
      .prepare(
        `EXPLAIN QUERY PLAN SELECT t.id FROM time_entries t
         WHERE t.employee_id = ? AND t.started_at < ? ORDER BY t.started_at DESC`,
      )
      .all('e1', 5000)
      .map((r) => (r as { detail: string }).detail)
      .join(' | ');
    expect(plan).toMatch(/USING (COVERING )?INDEX/);
    expect(plan).not.toMatch(/SCAN time_entries(?! USING)/);
  });
});
