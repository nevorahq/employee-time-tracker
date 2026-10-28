import type { Employee, TimeEntry } from '../../shared/types.ts';
import type { EmployeeRecord } from '../repositories/employees.ts';
import type { TimeEntryRecord } from '../repositories/timeEntries.ts';

export const toIso = (ms: number): string => new Date(ms).toISOString();

export const toEmployeeDto = (e: EmployeeRecord): Employee => ({
  id: e.id,
  name: e.name,
  createdAt: toIso(e.createdAt),
});

export const toTimeEntryDto = (t: TimeEntryRecord): TimeEntry => ({
  id: t.id,
  employeeId: t.employeeId,
  employeeName: t.employeeName,
  description: t.description,
  startedAt: toIso(t.startedAt),
  endedAt: t.endedAt === null ? null : toIso(t.endedAt),
});
