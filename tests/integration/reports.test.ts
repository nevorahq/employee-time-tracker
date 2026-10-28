import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, iso, type Json, type TestApp } from '../helpers/app.ts';

let app: TestApp;
afterEach(() => app?.close());

const MIN = 60_000;
const q = (params: Record<string, string>) => new URLSearchParams(params).toString();
const report = (a: TestApp, params: Record<string, string>) => a.get(`/api/reports/summary?${q(params)}`);

/** Period [09:00, 12:00) UTC on 2026-10-28. */
const P = { from: '2026-10-28T09:00:00Z', to: '2026-10-28T12:00:00Z' };

async function seed() {
  app = createTestApp({ start: '2026-10-28T08:00:00Z' });
  const ada = await app.createEmployee('Ada Example');
  const bob = await app.createEmployee('Bob Sample');
  const cy = await app.createEmployee('Cy Idle');
  // Ada: crosses the start (1 h inside), fully inside (30 min), starts exactly at `to` (0), ends exactly at `from` (0)
  await app.work(ada.id, 'before', '2026-10-28T07:00:00Z', '2026-10-28T09:00:00Z');
  await app.work(ada.id, 'crossing start', '2026-10-28T08:00:00Z', '2026-10-28T10:00:00Z');
  await app.work(ada.id, 'inside', '2026-10-28T10:30:00Z', '2026-10-28T11:00:00Z');
  await app.work(ada.id, 'after', '2026-10-28T12:00:00Z', '2026-10-28T13:00:00Z');
  // Bob: crosses the end (1 h inside)
  await app.work(bob.id, 'crossing end', '2026-10-28T11:00:00Z', '2026-10-28T13:00:00Z');
  app.clock.set(iso('2026-10-28T14:00:00Z'));
  return { ada, bob, cy };
}

describe('reports API', () => {
  it('[S22] sums the contributions of one employee in milliseconds', async () => {
    const { ada } = await seed();
    const res = await report(app, { ...P, employeeId: ada.id });
    expect(res.status).toBe(200);
    const emp = res.body.data.employees[0];
    expect(emp).toMatchObject({ employeeId: ada.id, name: 'Ada Example', entryCount: 2 });
    // 08:00–10:00 inside [09:00, 12:00) = 1 h, 10:30–11:00 = 30 min
    expect(emp.totalMs).toBe(90 * MIN);
    expect(emp.finalizedMs).toBe(90 * MIN);
    expect(emp.provisionalMs).toBe(0);
  });

  it('[S23] filters by employee: only their entries and totals', async () => {
    const { bob } = await seed();
    const res = await report(app, { ...P, employeeId: bob.id });
    expect(res.body.data.employees.map((e: Json) => e.employeeId)).toEqual([bob.id]);
    expect(res.body.data.entries.map((e: Json) => e.description)).toEqual(['crossing end']);
    expect(res.body.data.totals.totalMs).toBe(60 * MIN);
  });

  it('[S24] aggregates several employees and the grand total is their sum', async () => {
    const { ada, bob } = await seed();
    const res = await report(app, P);
    const { totals, employees } = res.body.data;
    expect(employees.map((e: Json) => e.name)).toEqual(['Ada Example', 'Bob Sample']); // Cy has no entries
    expect(employees.map((e: Json) => [e.employeeId, e.totalMs])).toEqual([
      [ada.id, 90 * MIN],
      [bob.id, 60 * MIN],
    ]);
    expect(totals.totalMs).toBe(150 * MIN);
    expect(totals.totalMs).toBe(employees.reduce((s: number, e: Json) => s + e.totalMs, 0));
  });

  it('[S25] returns zeros and empty arrays for a period without entries', async () => {
    await seed();
    const res = await report(app, { from: '2026-01-01T00:00:00Z', to: '2026-01-02T00:00:00Z' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      totals: { finalizedMs: 0, provisionalMs: 0, totalMs: 0 },
      employees: [],
      entries: [],
    });
  });

  it('[S25] returns an empty report for an unknown employee filter', async () => {
    await seed();
    const res = await report(app, { ...P, employeeId: '2d1ec2f0-5a3f-4a4e-8c0a-6a1a8f6b9a11' });
    expect(res.status).toBe(200);
    expect(res.body.data.totals.totalMs).toBe(0);
  });

  it('[S26] treats the end date as inclusive: the upper bound is local midnight of the next day, exclusive', async () => {
    app = createTestApp({ start: '2026-10-01T00:00:00+03:00' });
    const ada = await app.createEmployee('Ada');
    // Report for the calendar days Oct 1 and Oct 2 in Europe/Chisinau (UTC+3): [Oct 1 00:00, Oct 3 00:00)
    await app.work(ada.id, 'last minute of Oct 2', '2026-10-02T23:30:00+03:00', '2026-10-03T00:00:00+03:00');
    await app.work(ada.id, 'starts at the bound', '2026-10-03T00:00:00+03:00', '2026-10-03T01:00:00+03:00');
    app.clock.set(iso('2026-10-04T00:00:00+03:00'));
    const res = await report(app, { from: '2026-10-01T00:00:00+03:00', to: '2026-10-03T00:00:00+03:00' });
    expect(res.body.data.entries.map((e: Json) => e.description)).toEqual(['last minute of Oct 2']);
    expect(res.body.data.totals.totalMs).toBe(30 * MIN);
  });

  it('[S27] counts only the part after `from` for an entry crossing the start', async () => {
    const { ada } = await seed();
    const entry = (await report(app, { ...P, employeeId: ada.id })).body.data.entries.find(
      (e: Json) => e.description === 'crossing start',
    );
    expect(entry.contributionMs).toBe(60 * MIN);
  });

  it('[S28] counts only the part before `to` for an entry crossing the end', async () => {
    await seed();
    const entry = (await report(app, P)).body.data.entries.find((e: Json) => e.description === 'crossing end');
    expect(entry.contributionMs).toBe(60 * MIN);
  });

  it('[S29] leaves out entries entirely outside the period, including ones touching a bound', async () => {
    await seed();
    const descriptions = (await report(app, P)).body.data.entries.map((e: Json) => e.description);
    expect(descriptions).not.toContain('before'); // ends exactly at `from`
    expect(descriptions).not.toContain('after'); // starts exactly at `to`
    expect(descriptions.sort()).toEqual(['crossing end', 'crossing start', 'inside']);
  });

  it('[S30] reports an active timer as provisional up to evaluatedAt without inventing an end', async () => {
    app = createTestApp({ start: '2026-10-28T08:00:00Z' });
    const ada = await app.createEmployee('Ada');
    await app.work(ada.id, 'finished', '2026-10-28T10:00:00Z', '2026-10-28T10:30:00Z');
    const bob = await app.createEmployee('Bob');
    await app.work(bob.id, 'running', '2026-10-28T11:00:00Z', null);
    app.clock.set(iso('2026-10-28T11:30:00Z'));

    const res = await report(app, P);
    const { totals, entries, evaluatedAt, employees } = res.body.data;
    const running = entries.find((e: Json) => e.description === 'running');
    expect(running).toMatchObject({ isActive: true, endedAt: null, contributionMs: 30 * MIN });
    expect(evaluatedAt).toBe('2026-10-28T11:30:00.000Z');
    expect(totals).toEqual({ finalizedMs: 30 * MIN, provisionalMs: 30 * MIN, totalMs: 60 * MIN });
    expect(employees.find((e: Json) => e.name === 'Bob')).toMatchObject({ provisionalMs: 30 * MIN, finalizedMs: 0 });
    // The database still says the timer is running.
    expect(app.db.prepare('SELECT ended_at FROM time_entries WHERE description = ?').get('running')).toEqual({ ended_at: null });
  });

  it('[S30] an active timer keeps growing between two reports while stored data is unchanged', async () => {
    app = createTestApp({ start: '2026-10-28T10:00:00Z' });
    const ada = await app.createEmployee('Ada');
    await app.work(ada.id, 'running', '2026-10-28T10:00:00Z', null);
    app.clock.set(iso('2026-10-28T10:10:00Z'));
    const first = (await report(app, P)).body.data.totals.provisionalMs;
    app.clock.set(iso('2026-10-28T10:40:00Z'));
    const second = (await report(app, P)).body.data.totals.provisionalMs;
    expect([first, second]).toEqual([10 * MIN, 40 * MIN]);
  });

  it('[S30] clips a running timer at the end of the period', async () => {
    app = createTestApp({ start: '2026-10-28T08:00:00Z' });
    const ada = await app.createEmployee('Ada');
    await app.work(ada.id, 'running', '2026-10-28T11:00:00Z', null);
    app.clock.set(iso('2026-10-28T15:00:00Z'));
    expect((await report(app, P)).body.data.totals.provisionalMs).toBe(60 * MIN);
  });

  it('[S31] counts every entry exactly once and keeps the sum invariants', async () => {
    const { ada } = await seed();
    await app.work(ada.id, 'running', '2026-10-28T11:30:00Z', null);
    app.clock.set(iso('2026-10-28T11:45:00Z'));
    const { totals, employees, entries } = (await report(app, P)).body.data;
    const sumEntries = entries.reduce((s: number, e: Json) => s + e.contributionMs, 0);
    const sumEmployees = employees.reduce((s: number, e: Json) => s + e.totalMs, 0);
    expect(totals.totalMs).toBe(sumEmployees);
    expect(totals.totalMs).toBe(sumEntries);
    expect(totals.totalMs).toBe(totals.finalizedMs + totals.provisionalMs);
    for (const e of employees) expect(e.totalMs).toBe(e.finalizedMs + e.provisionalMs);
    expect(new Set(entries.map((e: Json) => e.id)).size).toBe(entries.length);
    expect(employees.reduce((s: number, e: Json) => s + e.entryCount, 0)).toBe(entries.length);
  });

  it('[S31] does not round: contributions are whole milliseconds', async () => {
    app = createTestApp({ start: '2026-10-28T09:00:00.000Z' });
    const ada = await app.createEmployee('Ada');
    app.clock.set(Date.parse('2026-10-28T10:00:00.001Z'));
    const t = (await app.post('/api/timer/start', { employeeId: ada.id, description: 'ms' })).body.data;
    app.clock.set(Date.parse('2026-10-28T10:00:00.004Z'));
    await app.post(`/api/timer/${t.id}/stop`);
    expect((await report(app, P)).body.data.totals.totalMs).toBe(3);
  });

  it('returns the period as UTC ISO strings and evaluatedAt', async () => {
    await seed();
    const { period, evaluatedAt } = (await report(app, { from: '2026-10-28T12:00:00+03:00', to: '2026-10-28T15:00:00+03:00' })).body.data;
    expect(period).toEqual({ from: '2026-10-28T09:00:00.000Z', to: '2026-10-28T12:00:00.000Z' });
    expect(evaluatedAt).toBe('2026-10-28T14:00:00.000Z');
  });

  describe('[S32] invalid ranges', () => {
    it.each([
      ['from equals to', { from: P.from, to: P.from }],
      ['from after to', { from: P.to, to: P.from }],
      ['longer than 366 days', { from: '2024-01-01T00:00:00Z', to: '2025-06-01T00:00:00Z' }],
    ])('rejects: %s with INVALID_DATE_RANGE', async (_label, params) => {
      app = createTestApp();
      const res = await report(app, params);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_DATE_RANGE');
    });

    it.each([
      ['missing from', { to: P.to }],
      ['missing to', { from: P.from }],
      ['date without time', { from: '2026-10-28', to: '2026-10-29' }],
      ['time without offset', { from: '2026-10-28T09:00:00', to: '2026-10-28T12:00:00' }],
      ['garbage', { from: 'yesterday', to: 'tomorrow' }],
      ['impossible date', { from: '2026-02-30T00:00:00Z', to: '2026-03-02T00:00:00Z' }],
      ['bad employee id', { ...P, employeeId: 'nope' }],
    ])('rejects: %s with VALIDATION_ERROR', async (_label, params) => {
      app = createTestApp();
      const res = await report(app, params);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('explains the expected date format when the offset is missing', async () => {
      app = createTestApp();
      const res = await report(app, { from: '2026-10-28', to: '2026-10-29' });
      expect(res.body.error.message).toMatch(/offset/i);
      expect(res.body.error.message).toMatch(/2026-10-28T10:00:00Z/);
    });

    it('accepts a full local-time year (366 days plus a DST hour)', async () => {
      app = createTestApp();
      const res = await report(app, { from: '2024-01-01T00:00:00+02:00', to: '2025-01-01T00:00:00+02:00' });
      expect(res.status).toBe(200);
    });
  });
});

describe('time entries (history) API', () => {
  async function history() {
    app = createTestApp({ start: '2026-10-20T08:00:00Z' });
    const ada = await app.createEmployee('Ada');
    const bob = await app.createEmployee('Bob');
    await app.work(ada.id, 'a1', '2026-10-20T09:00:00Z', '2026-10-20T10:00:00Z');
    await app.work(bob.id, 'b1', '2026-10-21T09:00:00Z', '2026-10-21T10:00:00Z');
    await app.work(ada.id, 'a2', '2026-10-22T09:00:00Z', '2026-10-22T10:00:00Z');
    await app.work(bob.id, 'b2', '2026-10-23T09:00:00Z', null);
    app.clock.set(iso('2026-10-23T12:00:00Z'));
    return { ada, bob };
  }
  const list = (params: Record<string, string> = {}) => app.get(`/api/time-entries?${q(params)}`);

  it('lists entries newest first with a total, including the active one as In progress', async () => {
    await history();
    const res = await list();
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(4);
    expect(res.body.data.entries.map((e: Json) => e.description)).toEqual(['b2', 'a2', 'b1', 'a1']);
    expect(res.body.data.entries[0]).toMatchObject({ endedAt: null, employeeName: 'Bob' });
  });

  it('filters by employee', async () => {
    const { ada } = await history();
    const res = await list({ employeeId: ada.id });
    expect(res.body.data.entries.map((e: Json) => e.description)).toEqual(['a2', 'a1']);
    expect(res.body.data.total).toBe(2);
  });

  it('filters by date range using the same [from, to) overlap rule as reports', async () => {
    await history();
    const res = await list({ from: '2026-10-21T09:00:00Z', to: '2026-10-22T09:00:00Z' });
    // a1 ended before `from`; a2 starts exactly at `to`; only b1 overlaps
    expect(res.body.data.entries.map((e: Json) => e.description)).toEqual(['b1']);
  });

  it('includes an entry that merely crosses the range boundary', async () => {
    await history();
    const res = await list({ from: '2026-10-21T09:30:00Z', to: '2026-10-21T09:45:00Z' });
    expect(res.body.data.entries.map((e: Json) => e.description)).toEqual(['b1']);
  });

  it('combines employee and date filters', async () => {
    const { bob } = await history();
    const res = await list({ employeeId: bob.id, from: '2026-10-22T00:00:00Z', to: '2026-10-24T00:00:00Z' });
    expect(res.body.data.entries.map((e: Json) => e.description)).toEqual(['b2']);
  });

  it('works with only one bound', async () => {
    await history();
    expect((await list({ from: '2026-10-22T00:00:00Z' })).body.data.total).toBe(2);
    expect((await list({ to: '2026-10-21T00:00:00Z' })).body.data.total).toBe(1);
  });

  it('pages with limit/offset and reports the unpaged total', async () => {
    await history();
    const res = await list({ limit: '2', offset: '1' });
    expect(res.body.data.entries.map((e: Json) => e.description)).toEqual(['a2', 'b1']);
    expect(res.body.data.total).toBe(4);
  });

  it('returns an empty page with total 0 when nothing matches', async () => {
    await history();
    expect((await list({ from: '2027-01-01T00:00:00Z', to: '2027-01-02T00:00:00Z' })).body.data).toEqual({ entries: [], total: 0 });
  });

  it('accepts limit 500 and rejects 501, 0 and garbage', async () => {
    await history();
    expect((await list({ limit: '500' })).status).toBe(200);
    for (const limit of ['501', '0', '-1', 'abc', '1.5']) {
      const res = await list({ limit });
      expect(res.status, `limit=${limit}`).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect((await list({ offset: '-1' })).status).toBe(400);
  });

  it('rejects dates without an offset and reversed ranges', async () => {
    await history();
    expect((await list({ from: '2026-10-21' })).status).toBe(400);
    const reversed = await list({ from: '2026-10-22T00:00:00Z', to: '2026-10-21T00:00:00Z' });
    expect(reversed.status).toBe(400);
    expect(reversed.body.error.code).toBe('INVALID_DATE_RANGE');
  });

  it('accepts offsets such as +02:00 when they are URL-encoded', async () => {
    await history();
    const res = await app.get(`/api/time-entries?from=${encodeURIComponent('2026-10-21T12:00:00+03:00')}`);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(3); // from = 09:00Z on Oct 21: b1, a2, b2 (a1 ended on Oct 20)
  });
});
