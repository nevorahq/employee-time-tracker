import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Container } from '../../src/server/container.ts';

/** Exercises the real route files (what Next calls) rather than the handler factories. */
const g = globalThis as unknown as { __timeTrackerContainer?: Container };
const savedPath = process.env.DATABASE_PATH;
let dir: string | undefined;

function resetProcessContainer() {
  g.__timeTrackerContainer?.db.close();
  delete g.__timeTrackerContainer;
}

beforeEach(resetProcessContainer);
afterEach(() => {
  resetProcessContainer();
  if (savedPath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = savedPath;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

const get = (path: string) => new Request(`http://test${path}`);

describe('route files when the database cannot be opened', () => {
  // A file cannot be a parent directory, so the database can never be created there.
  const unreachable = '/dev/null/cannot/exist.db';

  it('GET /api/health answers 503 DATABASE_UNAVAILABLE as JSON instead of throwing', async () => {
    process.env.DATABASE_PATH = unreachable;
    const { GET } = await import('../../app/api/health/route.ts');
    const res = await GET(get('/api/health'));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ error: { code: 'DATABASE_UNAVAILABLE', message: expect.any(String) } });
    expect(JSON.stringify(body)).not.toMatch(/ENOTDIR|\/dev\/null|mkdir/);
  });

  it('other endpoints fail the same way, never with an unhandled exception', async () => {
    process.env.DATABASE_PATH = unreachable;
    const employees = await import('../../app/api/employees/route.ts');
    const active = await import('../../app/api/timer/active/route.ts');
    for (const res of [await employees.GET(get('/api/employees')), await active.GET(get('/api/timer/active'))]) {
      expect(res.status).toBe(503);
      expect((await res.json()).error.code).toBe('DATABASE_UNAVAILABLE');
    }
  });

  it('recovers on its own once the database becomes reachable (a failed open is not cached)', async () => {
    process.env.DATABASE_PATH = unreachable;
    const { GET } = await import('../../app/api/health/route.ts');
    expect((await GET(get('/api/health'))).status).toBe(503);

    dir = mkdtempSync(join(tmpdir(), 'ett-route-'));
    process.env.DATABASE_PATH = join(dir, 'ok.db');
    const res = await GET(get('/api/health'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { status: 'ok', database: 'ok' } });
  });
});

describe('route files wiring on a working database', () => {
  it('serves employees and the stop route (dynamic [id] segment) through the real route modules', async () => {
    dir = mkdtempSync(join(tmpdir(), 'ett-route-'));
    process.env.DATABASE_PATH = join(dir, 'ok.db');
    const employees = await import('../../app/api/employees/route.ts');
    const start = await import('../../app/api/timer/start/route.ts');
    const stop = await import('../../app/api/timer/[id]/stop/route.ts');
    const post = (path: string, body?: unknown) =>
      new Request(`http://test${path}`, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

    const ada = (await (await employees.POST(post('/api/employees', { name: 'Ada' }))).json()).data;
    const timer = (await (await start.POST(post('/api/timer/start', { employeeId: ada.id, description: 'Work' }))).json()).data;
    const res = await stop.POST(post(`/api/timer/${timer.id}/stop`), {
      params: Promise.resolve({ id: timer.id }),
    } as Parameters<typeof stop.POST>[1]);
    expect(res.status).toBe(200);
    expect((await res.json()).data.id).toBe(timer.id);
  });

  it('answers unknown /api paths through the catch-all route with JSON', async () => {
    const catchAll = await import('../../app/api/[...slug]/route.ts');
    const res = catchAll.GET(get('/api/nope'));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
  });
});
