/** API contract types. Times are ISO 8601 UTC strings (ending in Z). */
export type Employee = { id: string; name: string; createdAt: string };

export type TimeEntry = {
  id: string;
  employeeId: string;
  employeeName: string;
  description: string;
  startedAt: string;
  endedAt: string | null;
};

export type ActiveTimers = { timers: TimeEntry[]; serverTime: string };

export type TimeEntryPage = { entries: TimeEntry[]; total: number };

export type Totals = { finalizedMs: number; provisionalMs: number; totalMs: number };

export type ReportEmployee = Totals & { employeeId: string; name: string; entryCount: number };

export type ReportEntry = {
  id: string;
  employeeId: string;
  employeeName: string;
  description: string;
  startedAt: string;
  endedAt: string | null;
  isActive: boolean;
  contributionMs: number;
};

export type Report = {
  period: { from: string; to: string };
  evaluatedAt: string;
  totals: Totals;
  employees: ReportEmployee[];
  entries: ReportEntry[];
};

export type HealthStatus = { status: 'ok'; database: 'ok' };
