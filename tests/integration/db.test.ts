import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../../src/server/db/open.ts';
import { migrate } from '../../src/server/db/migrate.ts';
import { MIGRATIONS } from '../../src/server/db/migrations.ts';
import { isSqliteError, sqliteCode } from '../../src/server/db/sqlite-errors.ts';
import { tmpDbPath } from '../helpers/db.ts';

const addEmployee = (db: Db, id: string, name = 'Ada Example') =>
  db.prepare('INSERT INTO employees (id, name, created_at) VALUES (?, ?, 1)').run(id, name);

const addEntry = (db: Db, id: string, employeeId: string, startedAt: number, endedAt: number | null) =>
  db
    .prepare(
      'INSERT INTO time_entries (id, employee_id, description, started_at, ended_at, created_at) VALUES (?, ?, ?, ?, ?, 1)',
    )
    .run(id, employeeId, 'Write report', startedAt, endedAt);

const expectSqliteError = (fn: () => unknown, code: string) => {
  try {
    fn();
  } catch (err) {
    expect(sqliteCode(err)).toBe(code);
    return;
  }
  throw new Error(`expected ${code}, but nothing was thrown`);
};

describe('openDatabase', () => {
  it('creates the directory and file, and applies the schema', () => {
    const path = tmpDbPath();
    expect(existsSync(dirname(path))).toBe(false);
    const db = openDatabase(path);
    expect(existsSync(path)).toBe(true);
    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
    expect(tables).toEqual([{ name: 'employees' }, { name: 'time_entries' }]);
    db.close();
  });

  it('sets the required pragmas on the connection (DB-2)', () => {
    const db = openDatabase(tmpDbPath());
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
    expect(db.pragma('synchronous', { simple: true })).toBe(2); // FULL
    db.close();
  });

  it('is idempotent: reopening keeps existing data and does not re-run migrations', () => {
    const path = tmpDbPath();
    const first = openDatabase(path);
    addEmployee(first, 'e1');
    addEntry(first, 't1', 'e1', 1000, null);
    first.close();

    const second = openDatabase(path);
    expect(second.prepare('SELECT COUNT(*) AS n FROM employees').get()).toEqual({ n: 1 });
    expect(second.prepare('SELECT ended_at FROM time_entries WHERE id = ?').get('t1')).toEqual({ ended_at: null });
    expect(second.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length);
    second.close();
  });

  it('applies only the migrations that are pending', () => {
    const db = openDatabase(tmpDbPath());
    const next = { version: MIGRATIONS.length + 1, sql: 'CREATE TABLE extra (id INTEGER PRIMARY KEY) STRICT;' };
    migrate(db, [...MIGRATIONS, next]);
    expect(db.pragma('user_version', { simple: true })).toBe(next.version);
    migrate(db, [...MIGRATIONS, next]); // second run must not try to create the table again
    db.close();
  });

  it('rolls back a failing migration entirely', () => {
    const db = openDatabase(tmpDbPath());
    const bad = {
      version: MIGRATIONS.length + 1,
      sql: 'CREATE TABLE half (id INTEGER PRIMARY KEY) STRICT; THIS IS NOT SQL;',
    };
    expect(() => migrate(db, [...MIGRATIONS, bad])).toThrow();
    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'half'").get()).toBeUndefined();
    db.close();
  });
});

describe('database constraints', () => {
  it('rejects a second active entry for the same employee (BR-1)', () => {
    const db = openDatabase(tmpDbPath());
    addEmployee(db, 'e1');
    addEntry(db, 't1', 'e1', 1000, null);
    expectSqliteError(() => addEntry(db, 't2', 'e1', 2000, null), 'SQLITE_CONSTRAINT_UNIQUE');
    expect(isSqliteError(new Error('x'), 'SQLITE_CONSTRAINT_UNIQUE')).toBe(false);
    db.close();
  });

  it('allows active entries for different employees at once (BR-2)', () => {
    const db = openDatabase(tmpDbPath());
    addEmployee(db, 'e1', 'Ada Example');
    addEmployee(db, 'e2', 'Ada Example'); // same name is allowed (FR-EMP-5)
    addEntry(db, 't1', 'e1', 1000, null);
    addEntry(db, 't2', 'e2', 1000, null);
    expect(db.prepare('SELECT COUNT(*) AS n FROM time_entries WHERE ended_at IS NULL').get()).toEqual({ n: 2 });
    db.close();
  });

  it('allows any number of finished entries for one employee', () => {
    const db = openDatabase(tmpDbPath());
    addEmployee(db, 'e1');
    addEntry(db, 't1', 'e1', 1000, 2000);
    addEntry(db, 't2', 'e1', 3000, 4000);
    addEntry(db, 't3', 'e1', 5000, null);
    db.close();
  });

  it('rejects an entry that ends before it starts (BR-3)', () => {
    const db = openDatabase(tmpDbPath());
    addEmployee(db, 'e1');
    expectSqliteError(() => addEntry(db, 't1', 'e1', 2000, 1000), 'SQLITE_CONSTRAINT_CHECK');
    db.close();
  });

  it('accepts a zero-length entry', () => {
    const db = openDatabase(tmpDbPath());
    addEmployee(db, 'e1');
    addEntry(db, 't1', 'e1', 1000, 1000);
    db.close();
  });

  it('rejects an entry for an unknown employee (foreign key)', () => {
    const db = openDatabase(tmpDbPath());
    expectSqliteError(() => addEntry(db, 't1', 'nobody', 1000, null), 'SQLITE_CONSTRAINT_FOREIGNKEY');
    db.close();
  });

  it('refuses to delete an employee that has entries (ON DELETE RESTRICT, BR-9)', () => {
    const db = openDatabase(tmpDbPath());
    addEmployee(db, 'e1');
    addEntry(db, 't1', 'e1', 1000, 2000);
    // SQLite reports a violated ON DELETE RESTRICT as a TRIGGER-class constraint error.
    expectSqliteError(() => db.prepare('DELETE FROM employees WHERE id = ?').run('e1'), 'SQLITE_CONSTRAINT_TRIGGER');
    expect(db.prepare('SELECT COUNT(*) AS n FROM employees').get()).toEqual({ n: 1 });
    db.close();
  });

  it.each([['empty', ''], ['padded', ' Ada '], ['too long', 'x'.repeat(101)]])(
    'rejects an invalid employee name: %s',
    (_label, name) => {
      const db = openDatabase(tmpDbPath());
      expectSqliteError(() => addEmployee(db, 'e1', name), 'SQLITE_CONSTRAINT_CHECK');
      db.close();
    },
  );

  it.each([['empty', ''], ['padded', ' task '], ['too long', 'x'.repeat(501)]])(
    'rejects an invalid description: %s',
    (_label, description) => {
      const db = openDatabase(tmpDbPath());
      addEmployee(db, 'e1');
      expectSqliteError(
        () =>
          db
            .prepare(
              'INSERT INTO time_entries (id, employee_id, description, started_at, created_at) VALUES (?, ?, ?, 1, 1)',
            )
            .run('t1', 'e1', description),
        'SQLITE_CONSTRAINT_CHECK',
      );
      db.close();
    },
  );

  it('rejects a non-integer timestamp (STRICT tables)', () => {
    const db = openDatabase(tmpDbPath());
    addEmployee(db, 'e1');
    expectSqliteError(
      () =>
        db
          .prepare(
            "INSERT INTO time_entries (id, employee_id, description, started_at, created_at) VALUES ('t1', 'e1', 'x', 'yesterday', 1)",
          )
          .run(),
      'SQLITE_CONSTRAINT_DATATYPE',
    );
    db.close();
  });
});
