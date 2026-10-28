import type { Db } from './open.ts';
import { MIGRATIONS, type Migration } from './migrations.ts';

const userVersion = (db: Db): number => db.pragma('user_version', { simple: true }) as number;

/** Applies only the migrations that are not applied yet; safe to call on every open. */
export function migrate(db: Db, migrations: readonly Migration[] = MIGRATIONS): void {
  const latest = migrations.reduce((max, m) => Math.max(max, m.version), 0);
  // Fast path: no write lock when the schema is already current.
  if (userVersion(db) >= latest) return;

  const apply = db.transaction(() => {
    // Re-read under the write lock: another connection may have migrated meanwhile.
    const current = userVersion(db);
    for (const m of migrations) {
      if (m.version <= current) continue;
      if (!Number.isInteger(m.version)) throw new Error(`Invalid migration version: ${m.version}`);
      db.exec(m.sql);
      db.pragma(`user_version = ${m.version}`);
    }
  });
  apply.immediate();
}
