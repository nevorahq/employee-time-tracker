import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, iso, type TestApp } from '../helpers/app.ts';

let app: TestApp;
afterEach(() => app?.close());

const countRows = (a: TestApp, where = '1=1') =>
  (a.db.prepare(`SELECT COUNT(*) AS n FROM time_entries WHERE ${where}`).get() as { n: number }).n;

describe('timer API', () => {
  it('[S5] starts a timer: 201, endedAt null, startedAt is the server time', async () => {
    app = createTestApp({ start: '2026-10-28T09:00:00Z' });
    const ada = await app.createEmployee('Ada Example');
    app.clock.set(iso('2026-10-28T09:15:00Z'));
    const res = await app.post('/api/timer/start', { employeeId: ada.id, description: '  Write report  ' });
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({
      id: expect.any(String),
      employeeId: ada.id,
      employeeName: 'Ada Example',
      description: 'Write report',
      startedAt: '2026-10-28T09:15:00.000Z',
      endedAt: null,
    });
    expect(countRows(app, 'ended_at IS NULL')).toBe(1);
  });

  it('[S5] ignores a client-supplied startedAt', async () => {
    app = createTestApp({ start: '2026-10-28T09:00:00Z' });
    const ada = await app.createEmployee('Ada');
    const res = await app.post('/api/timer/start', {
      employeeId: ada.id,
      description: 'x',
      startedAt: '2000-01-01T00:00:00Z',
    });
    expect(res.body.data.startedAt).toBe('2026-10-28T09:00:00.000Z');
  });

  it('[S6] stops a timer: 200, same record, endedAt >= startedAt, no new rows', async () => {
    app = createTestApp({ start: '2026-10-28T09:00:00Z' });
    const ada = await app.createEmployee('Ada');
    const started = (await app.post('/api/timer/start', { employeeId: ada.id, description: 'Work' })).body.data;
    app.clock.advance(5 * 60_000);
    const res = await app.post(`/api/timer/${started.id}/stop`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ ...started, endedAt: '2026-10-28T09:05:00.000Z' });
    expect(Date.parse(res.body.data.endedAt)).toBeGreaterThanOrEqual(Date.parse(res.body.data.startedAt));
    expect(countRows(app)).toBe(1);
    expect(countRows(app, 'ended_at IS NULL')).toBe(0);
  });

  it('[S7] refuses a second start for the same employee with TIMER_ALREADY_RUNNING', async () => {
    app = createTestApp();
    const ada = await app.createEmployee('Ada');
    expect((await app.post('/api/timer/start', { employeeId: ada.id, description: 'one' })).status).toBe(201);
    const res = await app.post('/api/timer/start', { employeeId: ada.id, description: 'two' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TIMER_ALREADY_RUNNING');
    expect(countRows(app, 'ended_at IS NULL')).toBe(1);
  });

  it('[S7] allows a new start after the previous timer was stopped', async () => {
    app = createTestApp();
    const ada = await app.createEmployee('Ada');
    await app.work(ada.id, 'one', '2026-10-28T09:00:00Z', '2026-10-28T10:00:00Z');
    expect((await app.post('/api/timer/start', { employeeId: ada.id, description: 'two' })).status).toBe(201);
  });

  it('[S8] runs timers of different employees at the same time', async () => {
    app = createTestApp();
    const ada = await app.createEmployee('Ada');
    const bob = await app.createEmployee('Bob');
    expect((await app.post('/api/timer/start', { employeeId: ada.id, description: 'a' })).status).toBe(201);
    expect((await app.post('/api/timer/start', { employeeId: bob.id, description: 'b' })).status).toBe(201);
    expect(countRows(app, 'ended_at IS NULL')).toBe(2);
  });

  it('[S9] returns TIMER_NOT_FOUND when stopping an unknown timer', async () => {
    app = createTestApp();
    const res = await app.post('/api/timer/2d1ec2f0-5a3f-4a4e-8c0a-6a1a8f6b9a11/stop');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TIMER_NOT_FOUND');
  });

  it('rejects a stop with an id that is not a UUID with VALIDATION_ERROR', async () => {
    app = createTestApp();
    const res = await app.post('/api/timer/not-a-uuid/stop');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('[S10] refuses a repeated stop with TIMER_ALREADY_STOPPED and leaves endedAt unchanged', async () => {
    app = createTestApp({ start: '2026-10-28T09:00:00Z' });
    const ada = await app.createEmployee('Ada');
    const started = (await app.post('/api/timer/start', { employeeId: ada.id, description: 'Work' })).body.data;
    app.clock.advance(60_000);
    const first = await app.post(`/api/timer/${started.id}/stop`);
    app.clock.advance(60_000);
    const second = await app.post(`/api/timer/${started.id}/stop`);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('TIMER_ALREADY_STOPPED');
    const row = app.db.prepare('SELECT ended_at FROM time_entries WHERE id = ?').get(started.id);
    expect(row).toEqual({ ended_at: iso(first.body.data.endedAt) });
  });

  it.each([
    ['empty', ''],
    ['only spaces', '    '],
    ['too long', 'x'.repeat(501)],
    ['not a string', 7],
  ])('[S11] rejects an invalid description: %s', async (_label, description) => {
    app = createTestApp();
    const ada = await app.createEmployee('Ada');
    const res = await app.post('/api/timer/start', { employeeId: ada.id, description });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(countRows(app)).toBe(0);
  });

  it('[S11] rejects a missing description', async () => {
    app = createTestApp();
    const ada = await app.createEmployee('Ada');
    const res = await app.post('/api/timer/start', { employeeId: ada.id });
    expect(res.status).toBe(400);
  });

  it('[S11] accepts a description of exactly 500 characters', async () => {
    app = createTestApp();
    const ada = await app.createEmployee('Ada');
    const res = await app.post('/api/timer/start', { employeeId: ada.id, description: 'x'.repeat(500) });
    expect(res.status).toBe(201);
  });

  it('[S4] returns EMPLOYEE_NOT_FOUND for an unknown employee', async () => {
    app = createTestApp();
    const res = await app.post('/api/timer/start', {
      employeeId: '2d1ec2f0-5a3f-4a4e-8c0a-6a1a8f6b9a11',
      description: 'Work',
    });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('EMPLOYEE_NOT_FOUND');
    expect(countRows(app)).toBe(0);
  });

  it('[S4] returns 400 for an employeeId that is not a UUID', async () => {
    app = createTestApp();
    for (const employeeId of ['nope', '', 123]) {
      const res = await app.post('/api/timer/start', { employeeId, description: 'Work' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('[S4] treats UUIDs case-insensitively: an uppercase employee or timer id finds the same record', async () => {
    app = createTestApp();
    const ada = await app.createEmployee('Ada');

    const started = await app.post('/api/timer/start', { employeeId: ada.id.toUpperCase(), description: 'Work' });
    expect(started.status).toBe(201);
    expect(started.body.data.employeeId).toBe(ada.id); // stored and returned in canonical lower case

    const active = await app.get(`/api/timer/active?employeeId=${ada.id.toUpperCase()}`);
    expect(active.body.data.timers).toHaveLength(1);

    const stopped = await app.post(`/api/timer/${started.body.data.id.toUpperCase()}/stop`);
    expect(stopped.status).toBe(200);
    expect(stopped.body.data.id).toBe(started.body.data.id);
    expect(countRows(app)).toBe(1);
  });

  describe('GET /api/timer/active', () => {
    it('returns active timers with the server time, and nothing else', async () => {
      app = createTestApp({ start: '2026-10-28T09:00:00Z' });
      const ada = await app.createEmployee('Ada');
      const bob = await app.createEmployee('Bob');
      await app.work(ada.id, 'done', '2026-10-28T09:00:00Z', '2026-10-28T09:30:00Z');
      const running = await app.work(bob.id, 'running', '2026-10-28T09:40:00Z', null);
      app.clock.set(iso('2026-10-28T10:00:00Z'));
      const res = await app.get('/api/timer/active');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ timers: [running], serverTime: '2026-10-28T10:00:00.000Z' });
    });

    it('filters by employee and validates the id', async () => {
      app = createTestApp();
      const ada = await app.createEmployee('Ada');
      const bob = await app.createEmployee('Bob');
      await app.work(ada.id, 'a', '2026-10-28T09:00:00Z', null);
      await app.work(bob.id, 'b', '2026-10-28T09:00:00Z', null);
      expect((await app.get(`/api/timer/active?employeeId=${bob.id}`)).body.data.timers).toHaveLength(1);
      expect((await app.get('/api/timer/active')).body.data.timers).toHaveLength(2);
      expect((await app.get('/api/timer/active?employeeId=nope')).status).toBe(400);
    });

    it('returns an empty list when nothing is running', async () => {
      app = createTestApp();
      expect((await app.get('/api/timer/active')).body.data.timers).toEqual([]);
    });
  });

  it('never ends a timer before it started when the system clock moved backwards (FR-TMR-10)', async () => {
    app = createTestApp({ start: '2026-10-28T09:00:00Z' });
    const ada = await app.createEmployee('Ada');
    const started = (await app.post('/api/timer/start', { employeeId: ada.id, description: 'Work' })).body.data;
    app.clock.set(iso('2026-10-28T08:00:00Z')); // NTP stepped the clock back an hour
    const res = await app.post(`/api/timer/${started.id}/stop`);
    expect(res.status).toBe(200);
    expect(res.body.data.endedAt).toBe(started.startedAt);
    expect(app.log.warns.some((m) => /clock moved backwards/i.test(m))).toBe(true);
  });

  it('does not warn about the clock on a normal stop', async () => {
    app = createTestApp();
    const ada = await app.createEmployee('Ada');
    await app.work(ada.id, 'Work', '2026-10-28T09:00:00Z', '2026-10-28T09:10:00Z');
    expect(app.log.warns).toEqual([]);
  });
});
