import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../../src/server/db/migrations.ts';
import { createTestApp, iso, type TestApp } from '../helpers/app.ts';

let app: TestApp;
afterEach(() => app?.close());

const MIN = 60_000;
type Row = { id: string; employee_id: string; description: string; started_at: number; ended_at: number | null };

describe('timer recovery after a restart', () => {
  it('[S13-S21] an active timer survives a genuine restart on the same database file', async () => {
    // S13: a temporary SQLite file with migrations applied
    app = createTestApp({ start: '2026-10-28T09:00:00Z' });
    expect(existsSync(app.path)).toBe(true);
    expect(app.db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length);

    // S14: create an employee and start a timer; the row is in the file with endedAt = null
    const ada = await app.createEmployee('Ada Example');
    const started = (await app.post('/api/timer/start', { employeeId: ada.id, description: 'Write report' })).body.data;
    const raw = new Database(app.path, { readonly: true });
    expect(raw.prepare('SELECT ended_at FROM time_entries WHERE id = ?').get(started.id)).toEqual({ ended_at: null });
    raw.close();

    // S15: close the connection and drop the app instance; nothing is kept in memory
    app.shutdown();
    expect(app.db.open).toBe(false);

    // The server is down for 90 minutes.
    app.clock.advance(90 * MIN);

    // S16: a new instance on the same file opens without losing data
    app.boot();
    expect(app.db.open).toBe(true);
    expect((await app.get('/api/employees')).body.data.map((e: { id: string }) => e.id)).toEqual([ada.id]);

    // S17: the active timer has the same id, employee, description and original startedAt
    const active = (await app.get('/api/timer/active')).body.data;
    expect(active.timers).toHaveLength(1);
    expect(active.timers[0]).toEqual(started);
    expect(active.timers[0]).toMatchObject({ id: started.id, employeeId: ada.id, description: 'Write report', endedAt: null });

    // S18: elapsed time (serverTime - startedAt) includes the downtime
    expect(Date.parse(active.serverTime) - Date.parse(active.timers[0].startedAt)).toBe(90 * MIN);

    // S19: the recovered timer is stopped by the normal stop
    const stopped = await app.post(`/api/timer/${started.id}/stop`);
    expect(stopped.status).toBe(200);

    // S20: the original row got a valid endedAt, with the same id
    const row = app.db.prepare('SELECT * FROM time_entries WHERE id = ?').get(started.id) as Row;
    expect(row.id).toBe(started.id);
    expect(row.started_at).toBe(iso(started.startedAt));
    expect(row.ended_at).toBe(iso('2026-10-28T10:30:00Z'));
    expect(row.ended_at).toBeGreaterThanOrEqual(row.started_at);

    // S21: exactly one row, no active timers
    expect(app.db.prepare('SELECT COUNT(*) AS n FROM time_entries').get()).toEqual({ n: 1 });
    expect(app.db.prepare('SELECT COUNT(*) AS n FROM time_entries WHERE ended_at IS NULL').get()).toEqual({ n: 0 });
    expect((await app.get('/api/timer/active')).body.data.timers).toEqual([]);
  });

  it('keeps several timers and finished history across a restart without creating new rows (FR-REC-4)', async () => {
    app = createTestApp({ start: '2026-10-28T08:00:00Z' });
    const ada = await app.createEmployee('Ada');
    const bob = await app.createEmployee('Bob');
    await app.work(ada.id, 'finished', '2026-10-28T08:00:00Z', '2026-10-28T08:30:00Z');
    const a = await app.work(ada.id, 'running a', '2026-10-28T09:00:00Z', null);
    const b = await app.work(bob.id, 'running b', '2026-10-28T09:05:00Z', null);
    const before = app.db.prepare('SELECT * FROM time_entries ORDER BY id').all();

    app.restart();
    app.restart(); // restarting twice must not change anything either

    expect(app.db.prepare('SELECT * FROM time_entries ORDER BY id').all()).toEqual(before);
    const timers = (await app.get('/api/timer/active')).body.data.timers;
    expect(timers.map((t: { id: string }) => t.id).sort()).toEqual([a.id, b.id].sort());
    expect((await app.get('/api/time-entries')).body.data.total).toBe(3);
  });

  it('recovers after a hard stop where the connection is never closed (kill -9)', async () => {
    app = createTestApp({ start: '2026-10-28T09:00:00Z' });
    const ada = await app.createEmployee('Ada');
    const started = (await app.post('/api/timer/start', { employeeId: ada.id, description: 'Work' })).body.data;

    // The first connection stays open and is simply abandoned, as when a process is killed.
    const after = new Database(app.path);
    try {
      const row = after.prepare('SELECT id, ended_at FROM time_entries').get() as { id: string; ended_at: number | null };
      expect(row).toEqual({ id: started.id, ended_at: null });
    } finally {
      after.close();
    }
  });

  it('keeps the original startedAt when a timer is recovered and the browser asks again', async () => {
    app = createTestApp({ start: '2026-10-28T09:00:00Z' });
    const ada = await app.createEmployee('Ada');
    const started = (await app.post('/api/timer/start', { employeeId: ada.id, description: 'Work' })).body.data;
    for (let i = 0; i < 3; i++) {
      app.clock.advance(10 * MIN);
      app.restart();
      const [timer] = (await app.get('/api/timer/active')).body.data.timers;
      expect(timer.startedAt).toBe(started.startedAt);
    }
  });

  it('has no shutdown hook that could touch time entries (FR-REC-2, BR-6)', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(name)) files.push(full);
      }
    };
    walk('src');
    walk('app');
    expect(files.length).toBeGreaterThan(0);
    const hooks = /process\s*\.\s*(on|once)\s*\(|\b(SIGTERM|SIGINT|beforeExit)\b|addEventListener\(\s*['"]unload/;
    expect(files.filter((f) => hooks.test(readFileSync(f, 'utf8')))).toEqual([]);
  });
});
