import type { ApiErrorBody, ErrorCode } from '@/shared/errors';
import type {
  ActiveTimers,
  Employee,
  Report,
  TimeEntry,
  TimeEntryPage,
} from '@/shared/types';

export class ApiError extends Error {
  readonly code: ErrorCode | 'NETWORK_ERROR' | 'UNEXPECTED';
  readonly status: number;

  constructor(code: ApiError['code'], status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

/** All requests go to the same origin and are never cached (UI-12). */
async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      cache: 'no-store',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('NETWORK_ERROR', 0, 'Cannot reach the server. Check your connection and try again.');
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw new ApiError('UNEXPECTED', res.status, 'The server sent an unexpected response.');
  }

  if (!res.ok) {
    const error = (payload as Partial<ApiErrorBody> | undefined)?.error;
    throw new ApiError(error?.code ?? 'UNEXPECTED', res.status, error?.message ?? 'Something went wrong.');
  }
  return (payload as { data: T }).data;
}

const query = (params: Record<string, string | number | undefined>): string => {
  const search = new URLSearchParams(); // encodes "+" in UTC offsets
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : '';
};

/** Active timers plus the browser/server clock offset measured when the response arrived (FR-REC-7). */
export type ActiveTimersSnapshot = ActiveTimers & { serverOffsetMs: number };

export const api = {
  listEmployees: () => request<Employee[]>('GET', '/api/employees'),
  createEmployee: (name: string) => request<Employee>('POST', '/api/employees', { name }),

  async activeTimers(): Promise<ActiveTimersSnapshot> {
    const data = await request<ActiveTimers>('GET', '/api/timer/active');
    return { ...data, serverOffsetMs: Date.parse(data.serverTime) - Date.now() };
  },
  startTimer: (employeeId: string, description: string) =>
    request<TimeEntry>('POST', '/api/timer/start', { employeeId, description }),
  stopTimer: (id: string) => request<TimeEntry>('POST', `/api/timer/${encodeURIComponent(id)}/stop`),

  listEntries: (p: { employeeId?: string; from?: string; to?: string; limit?: number; offset?: number }) =>
    request<TimeEntryPage>('GET', `/api/time-entries${query(p)}`),
  report: (p: { from: string; to: string; employeeId?: string }) =>
    request<Report>('GET', `/api/reports/summary${query(p)}`),
};
