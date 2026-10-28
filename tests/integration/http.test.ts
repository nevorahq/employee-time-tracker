import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/app.ts';

let app: TestApp;
afterEach(() => app?.close());

describe('cross-cutting HTTP behaviour', () => {
  it('answers an unknown /api path with a JSON NOT_FOUND', async () => {
    app = createTestApp();
    for (const [method, path] of [['GET', '/api/nope'], ['POST', '/api/employees/1/x'], ['GET', '/api/timer']] as const) {
      const res = await app.call(method, path);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.headers.get('content-type')).toMatch(/application\/json/);
    }
  });

  it('turns an unexpected failure into INTERNAL_ERROR without leaking details, and logs it', async () => {
    app = createTestApp();
    app.db.close(); // every query now throws a driver error
    const res = await app.get('/api/employees');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error.' } });
    expect(JSON.stringify(res.body)).not.toMatch(/sqlite|database connection|SELECT|\.ts|node_modules/i);
    expect(app.log.errors).toHaveLength(1);
  });

  it('maps a database that stays locked to 503 DB_BUSY with Retry-After (BR-10)', async () => {
    app = createTestApp();
    app.db.pragma('busy_timeout = 50'); // do not wait 5 s in the test
    const blocker = new Database(app.path);
    blocker.exec('BEGIN IMMEDIATE'); // a second connection holds the write lock
    try {
      const res = await app.post('/api/employees', { name: 'Ada' });
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('DB_BUSY');
      expect(res.headers.get('retry-after')).toBe('1');
      expect(app.log.warns.some((m) => /busy/i.test(m))).toBe(true);
    } finally {
      blocker.exec('ROLLBACK');
      blocker.close();
    }
    // Once the lock is gone the same request succeeds.
    expect((await app.post('/api/employees', { name: 'Ada' })).status).toBe(201);
  });

  it('does not write request bodies to the log (NFR-9)', async () => {
    app = createTestApp();
    await app.post('/api/employees', { name: 'Secret Person Name' });
    app.db.close();
    await app.post('/api/employees', { name: 'Secret Person Name' });
    expect(JSON.stringify(app.log.warns)).not.toContain('Secret');
  });
});
