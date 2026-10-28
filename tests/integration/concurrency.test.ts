import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/app.ts';
import { runInWorkers, tally } from '../helpers/workers.ts';
import type { Op } from '../workers/timer-worker.ts';

let app: TestApp;
afterEach(() => app?.close());

const WORKERS = 8;
const count = (a: TestApp, where = '1=1') =>
  (a.db.prepare(`SELECT COUNT(*) AS n FROM time_entries WHERE ${where}`).get() as { n: number }).n;

describe('concurrency across independent connections (worker_threads)', () => {
  it('[S12] concurrent starts for one employee: exactly one 201, the rest 409, no 5xx, one active row', async () => {
    app = createTestApp();
    const ada = await app.createEmployee('Ada Example');
    const start: Op = { kind: 'start', employeeId: ada.id, description: 'Race' };
    const jobs = Array.from({ length: WORKERS }, () => Array.from({ length: 10 }, () => start));

    const t = tally(await runInWorkers(app.path, jobs));

    expect(t.total).toBe(WORKERS * 10);
    expect(t.ok(201)).toBe(1);
    expect(t.ok(409)).toBe(WORKERS * 10 - 1);
    expect(t.code('TIMER_ALREADY_RUNNING')).toBe(WORKERS * 10 - 1);
    expect(t.serverErrors).toBe(0);
    expect(count(app, 'ended_at IS NULL')).toBe(1);
    expect(count(app)).toBe(1);
  });

  it('concurrent stops of one timer: exactly one 200, the rest 409 TIMER_ALREADY_STOPPED', async () => {
    app = createTestApp();
    const ada = await app.createEmployee('Ada');
    const timer = (await app.post('/api/timer/start', { employeeId: ada.id, description: 'Work' })).body.data;
    const stop: Op = { kind: 'stop', id: timer.id };
    const jobs = Array.from({ length: WORKERS }, () => Array.from({ length: 5 }, () => stop));

    const t = tally(await runInWorkers(app.path, jobs));

    expect(t.ok(200)).toBe(1);
    expect(t.ok(409)).toBe(WORKERS * 5 - 1);
    expect(t.code('TIMER_ALREADY_STOPPED')).toBe(WORKERS * 5 - 1);
    expect(t.serverErrors).toBe(0);
    expect(count(app)).toBe(1);
    expect(count(app, 'ended_at IS NULL')).toBe(0);
  });

  it('timers of different employees under load all succeed: the index is not global', async () => {
    app = createTestApp();
    const employees = await Promise.all(Array.from({ length: WORKERS }, (_, i) => app.createEmployee(`Employee ${i}`)));
    const CYCLES = 25;

    // Phase 1: every worker repeatedly starts and stops timers for its own employee, all at once.
    const cycles = employees.map((e) =>
      Array.from({ length: CYCLES }, () => ({ kind: 'cycle', employeeId: e.id, description: 'Parallel' }) as Op),
    );
    const t1 = tally(await runInWorkers(app.path, cycles));
    expect(t1.serverErrors).toBe(0);
    expect(t1.ok(201)).toBe(WORKERS * CYCLES);
    expect(t1.ok(200)).toBe(WORKERS * CYCLES);
    expect(count(app)).toBe(WORKERS * CYCLES);
    expect(count(app, 'ended_at IS NULL')).toBe(0);

    // Phase 2: all employees run a timer at the same time (BR-2).
    const starts = employees.map((e) => [{ kind: 'start', employeeId: e.id, description: 'Together' } as Op]);
    const t2 = tally(await runInWorkers(app.path, starts));
    expect(t2.ok(201)).toBe(WORKERS);
    expect(t2.serverErrors).toBe(0);
    expect(count(app, 'ended_at IS NULL')).toBe(WORKERS);
  });

  it('mixed load: a stop and a start of the same employee never leave two active rows', async () => {
    app = createTestApp();
    const ada = await app.createEmployee('Ada');
    const first = (await app.post('/api/timer/start', { employeeId: ada.id, description: 'First' })).body.data;
    const jobs: Op[][] = [
      [{ kind: 'stop', id: first.id }],
      ...Array.from({ length: 6 }, () => Array.from({ length: 5 }, () => ({ kind: 'start', employeeId: ada.id, description: 'Next' }) as Op)),
    ];
    const t = tally(await runInWorkers(app.path, jobs));
    expect(t.serverErrors).toBe(0);
    expect(count(app, 'ended_at IS NULL')).toBeLessThanOrEqual(1);
    expect(t.ok(201)).toBe(count(app) - 1); // every 201 corresponds to exactly one new row
  });
});
