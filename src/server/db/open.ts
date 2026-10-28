import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { migrate } from './migrate.ts';

export type Db = Database.Database;

/** Opens (creating if needed) the SQLite file, applies pragmas and pending migrations (DB-2..DB-4). */
export function openDatabase(path: string): Db {
  const file = resolve(path);
  mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  try {
    db.pragma('busy_timeout = 5000'); // first: later statements may have to wait for a lock
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
    db.pragma('foreign_keys = ON');
    migrate(db);
    return db;
  } catch (err) {
    db.close();
    throw err;
  }
}
