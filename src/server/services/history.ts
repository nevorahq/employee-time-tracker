import type { Clock } from '../clock.ts';
import { toTimeEntryDto } from '../domain/dto.ts';
import { assertValidRange } from '../domain/range.ts';
import type { TimeEntryRepo } from '../repositories/timeEntries.ts';
import { HISTORY_DEFAULT_LIMIT } from '../../shared/schemas.ts';
import type { TimeEntryPage } from '../../shared/types.ts';

export type HistoryQuery = {
  employeeId?: string;
  from?: number;
  to?: number;
  limit?: number;
  offset?: number;
};

export function createHistoryService(entries: TimeEntryRepo, clock: Clock) {
  return {
    list(q: HistoryQuery): TimeEntryPage {
      assertValidRange(q.from, q.to);
      const filter = { employeeId: q.employeeId, from: q.from, to: q.to, evaluatedAt: clock.now() };
      const page = { limit: q.limit ?? HISTORY_DEFAULT_LIMIT, offset: q.offset ?? 0 };
      return {
        entries: entries.findOverlapping(filter, page).map(toTimeEntryDto),
        total: entries.countOverlapping(filter),
      };
    },
  };
}

export type HistoryService = ReturnType<typeof createHistoryService>;
