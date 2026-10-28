import { afterEach, describe, expect, it } from 'vitest';
import { SeedRefusedError, seedDemoData } from '../../src/server/seed.ts';
import { createTestApp, iso, type Json, type TestApp } from '../helpers/app.ts';

let app: TestApp;
afterEach(() => app?.close());

const NOW = iso('2026-10-28T12:00:00Z');
const count = (a: TestApp, sql: string) => (a.db.prepare(sql).get() as { n: number }).n;

describe('npm run seed (demo data)', () => {
  it('creates 5 employees, two weeks of finished entries and exactly one running timer', () => {
    app = createTestApp({ start: NOW });
    const summary = seedDemoData(app.db, NOW);

    expect(summary.employees).toBe(5);
    expect(count(app, 'SELECT COUNT(*) AS n FROM employees')).toBe(5);
    expect(summary.activeTimers).toBe(1);
    expect(count(app, 'SELECT COUNT(*) AS n FROM time_entries WHERE ended_at IS NULL')).toBe(1);
    expect(count(app, 'SELECT COUNT(*) AS n FROM time_entries WHERE ended_at IS NOT NULL')).toBe(summary.finishedEntries);
    expect(summary.finishedEntries).toBeGreaterThan(30);
    expect(count(app, `SELECT COUNT(*) AS n FROM time_entries WHERE started_at < ${NOW - 15 * 86_400_000}`)).toBe(0);
    expect(count(app, `SELECT COUNT(*) AS n FROM time_entries WHERE started_at > ${NOW} OR ended_at > ${NOW}`)).toBe(0);
  });

  it('produces data the report accepts, with the sum invariants intact', async () => {
    app = createTestApp({ start: NOW });
    seedDemoData(app.db, NOW);
    const res = await app.get(
      `/api/reports/summary?${new URLSearchParams({ from: '2026-10-01T00:00:00Z', to: '2026-10-29T00:00:00Z' })}`,
    );
    expect(res.status).toBe(200);
    const { totals, employees, entries } = res.body.data;
    expect(employees).toHaveLength(5);
    expect(totals.provisionalMs).toBe(45 * 60_000);
    expect(totals.totalMs).toBe(entries.reduce((s: number, e: Json) => s + e.contributionMs, 0));
    expect(totals.totalMs).toBe(employees.reduce((s: number, e: Json) => s + e.totalMs, 0));
  });

  it('uses only fictional names', async () => {
    app = createTestApp({ start: NOW });
    seedDemoData(app.db, NOW);
    const names = (await app.get('/api/employees')).body.data.map((e: Json) => e.name);
    expect(names).toEqual(['Ada Example', 'Bob Sample', 'Carla Testwell', 'Dev Placeholder', 'Eli Fixture']);
  });

  it('refuses to run twice and leaves the data untouched', () => {
    app = createTestApp({ start: NOW });
    seedDemoData(app.db, NOW);
    const before = app.db.prepare('SELECT * FROM time_entries ORDER BY id').all();
    expect(() => seedDemoData(app.db, NOW)).toThrow(SeedRefusedError);
    expect(app.db.prepare('SELECT * FROM time_entries ORDER BY id').all()).toEqual(before);
    expect(count(app, 'SELECT COUNT(*) AS n FROM employees')).toBe(5);
  });

  it('refuses a database that already has an employee and does not change it', async () => {
    app = createTestApp({ start: NOW });
    const mine = await app.createEmployee('Real Existing Person');
    expect(() => seedDemoData(app.db, NOW)).toThrow(/already contains employees/);
    expect((await app.get('/api/employees')).body.data).toEqual([mine]);
    expect(count(app, 'SELECT COUNT(*) AS n FROM time_entries')).toBe(0);
  });
});
