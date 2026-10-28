import { openDatabase, type Db } from '../../src/server/db/open.ts';
import { createContainer, type Container } from '../../src/server/container.ts';
import { employeeHandlers } from '../../src/server/handlers/employees.ts';
import { healthHandlers } from '../../src/server/handlers/health.ts';
import { notFound } from '../../src/server/handlers/notFound.ts';
import { reportHandlers } from '../../src/server/handlers/reports.ts';
import { timeEntryHandlers } from '../../src/server/handlers/timeEntries.ts';
import { timerHandlers } from '../../src/server/handlers/timer.ts';
import type { Logger } from '../../src/server/logger.ts';
import { FakeClock } from './fake-clock.ts';
import { tmpDbPath } from './db.ts';

// Response bodies are asserted structurally in tests, so they are deliberately loosely typed (NFR-14).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;
export type ApiResult<T = Json> = { status: number; body: T; headers: Headers };

export const iso = (value: string) => Date.parse(value);

export function capturingLogger() {
  const warns: string[] = [];
  const errors: unknown[] = [];
  const logger: Logger = {
    warn: (message) => void warns.push(message),
    error: (_message, error) => void errors.push(error),
  };
  return { logger, warns, errors };
}

/** A Web Request, exactly what a Route Handler receives. */
export const req = (method: string, path: string, body?: unknown) =>
  new Request(`http://test${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });

/** Routes a request to the same handler factories the route files use. */
function route(c: Container, request: Request): Promise<Response> | Response {
  const url = new URL(request.url);
  const key = `${request.method} ${url.pathname}`;
  const stop = /^POST \/api\/timer\/([^/]+)\/stop$/.exec(key);
  if (stop?.[1] !== undefined) return timerHandlers(c).stop(request, stop[1]);
  switch (key) {
    case 'GET /api/health':
      return healthHandlers(c).check(request);
    case 'GET /api/employees':
      return employeeHandlers(c).list(request);
    case 'POST /api/employees':
      return employeeHandlers(c).create(request);
    case 'GET /api/timer/active':
      return timerHandlers(c).active(request);
    case 'POST /api/timer/start':
      return timerHandlers(c).start(request);
    case 'GET /api/time-entries':
      return timeEntryHandlers(c).list(request);
    case 'GET /api/reports/summary':
      return reportHandlers(c).summary(request);
    default:
      return notFound(request);
  }
}

export type TestApp = ReturnType<typeof createTestApp>;

/** One "process": a database connection + container on a temp file. `restart()` builds a new one. */
export function createTestApp(opts: { path?: string; start?: number | string; clock?: FakeClock } = {}) {
  const path = opts.path ?? tmpDbPath();
  const clock =
    opts.clock ?? new FakeClock(typeof opts.start === 'string' ? iso(opts.start) : (opts.start ?? iso('2026-10-28T09:00:00Z')));
  const log = capturingLogger();
  let db: Db = openDatabase(path);
  let container = createContainer({ db, clock, logger: log.logger });

  async function call<T = Json>(method: string, p: string, body?: unknown): Promise<ApiResult<T>> {
    const res = await route(container, req(method, p, body));
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined, headers: res.headers };
  }

  const app = {
    path,
    clock,
    log,
    get db() {
      return db;
    },
    get container() {
      return container;
    },
    call,
    get: <T = Json>(p: string) => call<T>('GET', p),
    post: <T = Json>(p: string, body?: unknown) => call<T>('POST', p, body),

    async createEmployee(name: string): Promise<{ id: string; name: string; createdAt: string }> {
      const res = await call('POST', '/api/employees', { name });
      if (res.status !== 201) throw new Error(`createEmployee failed: ${res.status}`);
      return res.body.data;
    },

    /** Records work between two instants using the fake clock. `end = null` leaves the timer running. */
    async work(employeeId: string, description: string, start: string, end: string | null) {
      clock.set(iso(start));
      const started = await call('POST', '/api/timer/start', { employeeId, description });
      if (started.status !== 201) throw new Error(`start failed: ${started.status} ${JSON.stringify(started.body)}`);
      if (end === null) return started.body.data;
      clock.set(iso(end));
      const stopped = await call('POST', `/api/timer/${started.body.data.id}/stop`);
      if (stopped.status !== 200) throw new Error(`stop failed: ${stopped.status}`);
      return stopped.body.data;
    },

    /** Closes the connection; nothing of this "process" is left in memory. */
    shutdown() {
      db.close();
    },

    /** Starts a new "process": a new connection and container on the same database file. */
    boot() {
      db = openDatabase(path);
      container = createContainer({ db, clock, logger: log.logger });
    },

    /** Simulates a process restart: close the connection, open a new one on the same file. */
    restart() {
      app.shutdown();
      app.boot();
    },

    close() {
      if (db.open) db.close();
    },
  };
  return app;
}
