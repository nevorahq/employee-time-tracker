/**
 * Schema migrations, applied in order by PRAGMA user_version.
 * Embedded as strings (not .sql files) so they survive `next build` file tracing.
 * Migrations are append-only and never DROP anything (BR-9, DB-4).
 */
export type Migration = { version: number; sql: string };

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    sql: `
CREATE TABLE employees (
  id          TEXT    PRIMARY KEY,
  name        TEXT    NOT NULL
              CHECK (length(name) BETWEEN 1 AND 100 AND name = trim(name)),
  created_at  INTEGER NOT NULL
) STRICT;

CREATE TABLE time_entries (
  id           TEXT    PRIMARY KEY,
  employee_id  TEXT    NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  description  TEXT    NOT NULL
               CHECK (length(description) BETWEEN 1 AND 500 AND description = trim(description)),
  started_at   INTEGER NOT NULL,
  ended_at     INTEGER,
  created_at   INTEGER NOT NULL,
  CHECK (ended_at IS NULL OR ended_at >= started_at)
) STRICT;

-- invariant "at most one active timer per employee" at the database level
CREATE UNIQUE INDEX ux_time_entries_one_active
  ON time_entries(employee_id) WHERE ended_at IS NULL;
-- history and reports, per employee and for everyone
CREATE INDEX ix_time_entries_employee_started ON time_entries(employee_id, started_at);
CREATE INDEX ix_time_entries_started ON time_entries(started_at);
`,
  },
];
