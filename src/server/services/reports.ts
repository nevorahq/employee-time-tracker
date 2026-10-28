import type { Clock } from '../clock.ts';
import { toIso } from '../domain/dto.ts';
import { assertValidRange } from '../domain/range.ts';
import { overlapMs } from '../domain/time.ts';
import type { TimeEntryRepo } from '../repositories/timeEntries.ts';
import type { Report, ReportEmployee, ReportEntry } from '../../shared/types.ts';

export type ReportQuery = { from: number; to: number; employeeId?: string };

export function createReportService(entries: TimeEntryRepo, clock: Clock) {
  return {
    summary({ from, to, employeeId }: ReportQuery): Report {
      assertValidRange(from, to);
      // Fixed once per request; active entries are measured up to this moment and never written back (BR-12).
      const evaluatedAt = clock.now();
      const rows = entries.findOverlapping({ employeeId, from, to, evaluatedAt });

      const byEmployee = new Map<string, ReportEmployee>();
      const reportEntries: ReportEntry[] = [];
      const totals = { finalizedMs: 0, provisionalMs: 0, totalMs: 0 };

      for (const row of rows) {
        const isActive = row.endedAt === null;
        const contributionMs = overlapMs(row.startedAt, row.endedAt ?? evaluatedAt, from, to);

        let emp = byEmployee.get(row.employeeId);
        if (!emp) {
          emp = { employeeId: row.employeeId, name: row.employeeName, entryCount: 0, finalizedMs: 0, provisionalMs: 0, totalMs: 0 };
          byEmployee.set(row.employeeId, emp);
        }
        const bucket = isActive ? 'provisionalMs' : 'finalizedMs';
        emp.entryCount += 1;
        emp[bucket] += contributionMs;
        emp.totalMs += contributionMs;
        totals[bucket] += contributionMs;
        totals.totalMs += contributionMs;

        reportEntries.push({
          id: row.id,
          employeeId: row.employeeId,
          employeeName: row.employeeName,
          description: row.description,
          startedAt: toIso(row.startedAt),
          endedAt: row.endedAt === null ? null : toIso(row.endedAt),
          isActive,
          contributionMs,
        });
      }

      const employees = [...byEmployee.values()].sort(
        (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.employeeId.localeCompare(b.employeeId),
      );

      return {
        period: { from: toIso(from), to: toIso(to) },
        evaluatedAt: toIso(evaluatedAt),
        totals,
        employees,
        entries: reportEntries,
      };
    },
  };
}

export type ReportService = ReturnType<typeof createReportService>;
