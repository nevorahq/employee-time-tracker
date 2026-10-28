import { randomUUID } from 'node:crypto';
import type { Db } from './db/open.ts';
import { createEmployeeRepo } from './repositories/employees.ts';
import { createTimeEntryRepo } from './repositories/timeEntries.ts';

/** Fictional people and tasks only (NFR-7). */
const EMPLOYEES = ['Ada Example', 'Bob Sample', 'Carla Testwell', 'Dev Placeholder', 'Eli Fixture'];
const TASKS = [
  'Draft the release notes',
  'Review a pull request',
  'Fix a flaky test',
  'Plan the sprint',
  'Update the documentation',
  'Investigate a slow query',
  'Pair on the reporting page',
  'Triage incoming issues',
];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const DAYS = 14;

export type SeedSummary = { employees: number; finishedEntries: number; activeTimers: number };

export class SeedRefusedError extends Error {}

/** Small deterministic generator so the demo data is the same on every run. */
function lcg(seed: number) {
  let state = seed;
  return (max: number) => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state % max;
  };
}

/**
 * Fills an EMPTY database with demo data: 5 employees, finished entries for the last two weeks
 * and one running timer. It refuses to touch a database that already has employees and never deletes anything.
 */
export function seedDemoData(db: Db, now: number): SeedSummary {
  const employees = createEmployeeRepo(db);
  const entries = createTimeEntryRepo(db);
  const next = lcg(42);

  const run = db.transaction((): SeedSummary => {
    if (employees.list().length > 0) {
      throw new SeedRefusedError('The database already contains employees; refusing to seed it.');
    }

    const created = EMPLOYEES.map((name, i) =>
      employees.insert({ id: randomUUID(), name, createdAt: now - (DAYS + 1) * DAY + i * MINUTE }),
    );

    const midnight = Math.floor(now / DAY) * DAY; // UTC midnight keeps the data independent of the server time zone
    let finished = 0;
    for (let d = DAYS; d >= 1; d--) {
      const dayStart = midnight - d * DAY;
      const weekday = new Date(dayStart).getUTCDay();
      if (weekday === 0 || weekday === 6) continue;
      for (const employee of created) {
        let cursor = dayStart + 8 * HOUR + next(60) * MINUTE;
        const count = 1 + next(3);
        for (let n = 0; n < count; n++) {
          const length = (30 + next(120)) * MINUTE;
          const id = randomUUID();
          entries.insertActive({
            id,
            employeeId: employee.id,
            description: TASKS[next(TASKS.length)]!,
            startedAt: cursor,
            createdAt: cursor,
          });
          entries.stopActive(id, cursor + length);
          cursor += length + (10 + next(50)) * MINUTE;
          finished += 1;
        }
      }
    }

    const last = created[created.length - 1]!;
    const startedAt = now - 45 * MINUTE;
    entries.insertActive({
      id: randomUUID(),
      employeeId: last.id,
      description: 'Pair on the reporting page',
      startedAt,
      createdAt: startedAt,
    });

    return { employees: created.length, finishedEntries: finished, activeTimers: 1 };
  });

  return run.immediate();
}
