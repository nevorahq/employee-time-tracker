import { databasePath } from './config.ts';
import { systemClock, type Clock } from './clock.ts';
import type { Db } from './db/open.ts';
import { openDatabase } from './db/open.ts';
import { consoleLogger, type Logger } from './logger.ts';
import { createEmployeeRepo } from './repositories/employees.ts';
import { createTimeEntryRepo } from './repositories/timeEntries.ts';
import { createEmployeeService, type EmployeeService } from './services/employees.ts';
import { createHistoryService, type HistoryService } from './services/history.ts';
import { createReportService, type ReportService } from './services/reports.ts';
import { createTimerService, type TimerService } from './services/timer.ts';

export type Container = {
  db: Db;
  clock: Clock;
  logger: Logger;
  employees: EmployeeService;
  timers: TimerService;
  history: HistoryService;
  reports: ReportService;
};

/** Wires repositories and services around an open database. Tests build their own. */
export function createContainer({
  db,
  clock,
  logger = consoleLogger,
}: {
  db: Db;
  clock: Clock;
  logger?: Logger;
}): Container {
  const employeeRepo = createEmployeeRepo(db);
  const entryRepo = createTimeEntryRepo(db);
  return {
    db,
    clock,
    logger,
    employees: createEmployeeService(employeeRepo, clock),
    timers: createTimerService({ db, employees: employeeRepo, entries: entryRepo, clock, logger }),
    history: createHistoryService(entryRepo, clock),
    reports: createReportService(entryRepo, clock),
  };
}

const g = globalThis as unknown as { __timeTrackerContainer?: Container };

/**
 * Process-wide container. The database is opened on first use, never at import time,
 * and kept on globalThis so hot reload does not open a new connection per edit.
 */
export function getContainer(): Container {
  return (g.__timeTrackerContainer ??= createContainer({
    db: openDatabase(databasePath()),
    clock: systemClock,
  }));
}
