import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/app.ts';

let app: TestApp;
afterEach(() => app?.close());

describe('health', () => {
  it('returns 200 ok while the database answers', async () => {
    app = createTestApp();
    const res = await app.get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { status: 'ok', database: 'ok' } });
  });

  it('returns 503 DATABASE_UNAVAILABLE once the database connection is closed', async () => {
    app = createTestApp();
    app.db.close();
    const res = await app.get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('DATABASE_UNAVAILABLE');
    expect(res.body.data).toBeUndefined();
  });
});
