import { randomUUID } from 'node:crypto';
import type { Clock } from '../clock.ts';
import type { Db } from '../db/open.ts';
import { isSqliteError } from '../db/sqlite-errors.ts';
import { toIso, toTimeEntryDto } from '../domain/dto.ts';
import { AppError } from '../domain/errors.ts';
import type { Logger } from '../logger.ts';
import type { EmployeeRepo } from '../repositories/employees.ts';
import type { TimeEntryRepo } from '../repositories/timeEntries.ts';
import type { ActiveTimers, TimeEntry } from '../../shared/types.ts';

type Deps = { db: Db; employees: EmployeeRepo; entries: TimeEntryRepo; clock: Clock; logger: Logger };

export function createTimerService({ db, employees, entries, clock, logger }: Deps) {
  // BEGIN IMMEDIATE: the employee check and the INSERT happen under one write lock (BR-4).
  const startTx = db.transaction((employeeId: string, description: string): TimeEntry => {
    if (!employees.exists(employeeId)) throw new AppError('EMPLOYEE_NOT_FOUND');
    if (entries.listActive(employeeId).length > 0) throw new AppError('TIMER_ALREADY_RUNNING');
    const now = clock.now();
    try {
      return toTimeEntryDto(
        entries.insertActive({ id: randomUUID(), employeeId, description, startedAt: now, createdAt: now }),
      );
    } catch (err) {
      // The partial unique index is the last line of defence between connections (BR-1).
      if (isSqliteError(err, 'SQLITE_CONSTRAINT_UNIQUE')) throw new AppError('TIMER_ALREADY_RUNNING');
      throw err;
    }
  });

  const stopTx = db.transaction((id: string): TimeEntry => {
    const now = clock.now();
    const stopped = entries.stopActive(id, now);
    if (!stopped) {
      throw new AppError(entries.findById(id) ? 'TIMER_ALREADY_STOPPED' : 'TIMER_NOT_FOUND');
    }
    if (stopped.endedAt !== null && stopped.endedAt > now) {
      // Stored end was clamped up to the start (FR-TMR-10).
      logger.warn('System clock moved backwards; stopped timer at its start time.', { timerId: id });
    }
    return toTimeEntryDto(stopped);
  });

  return {
    start: (employeeId: string, description: string): TimeEntry => startTx.immediate(employeeId, description),
    stop: (id: string): TimeEntry => stopTx.immediate(id),

    active(employeeId?: string): ActiveTimers {
      return { timers: entries.listActive(employeeId).map(toTimeEntryDto), serverTime: toIso(clock.now()) };
    },
  };
}

export type TimerService = ReturnType<typeof createTimerService>;
