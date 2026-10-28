import type { Db } from '../db/open.ts';

export type EmployeeRecord = { id: string; name: string; createdAt: number };

type Row = { id: string; name: string; created_at: number };
const toRecord = (r: Row): EmployeeRecord => ({ id: r.id, name: r.name, createdAt: r.created_at });

export function createEmployeeRepo(db: Db) {
  const insert = db.prepare('INSERT INTO employees (id, name, created_at) VALUES (@id, @name, @createdAt)');
  const list = db.prepare('SELECT id, name, created_at FROM employees ORDER BY name COLLATE NOCASE, name, id');
  const exists = db.prepare('SELECT 1 AS found FROM employees WHERE id = ?');

  return {
    insert(e: EmployeeRecord): EmployeeRecord {
      insert.run(e);
      return e;
    },
    list: (): EmployeeRecord[] => (list.all() as Row[]).map(toRecord),
    exists: (id: string): boolean => exists.get(id) !== undefined,
  };
}

export type EmployeeRepo = ReturnType<typeof createEmployeeRepo>;
