import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, req, type TestApp } from '../helpers/app.ts';
import { employeeHandlers } from '../../src/server/handlers/employees.ts';

let app: TestApp;
afterEach(() => app?.close());

describe('employees API', () => {
  it('[S1] creates an employee with a server-side id and createdAt, trimming the name', async () => {
    app = createTestApp({ start: '2026-10-28T09:00:00Z' });
    const res = await app.post('/api/employees', { name: '  Ada Example  ' });
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      name: 'Ada Example',
      createdAt: '2026-10-28T09:00:00.000Z',
    });
    expect(app.db.prepare('SELECT name FROM employees').all()).toEqual([{ name: 'Ada Example' }]);
  });

  it('ignores client-supplied id and createdAt', async () => {
    app = createTestApp();
    const res = await app.post('/api/employees', { name: 'Ada', id: 'x', createdAt: '2000-01-01T00:00:00Z' });
    expect(res.status).toBe(201);
    expect(res.body.data.id).not.toBe('x');
    expect(res.body.data.createdAt).toBe('2026-10-28T09:00:00.000Z');
  });

  it.each([
    ['empty', ''],
    ['only spaces', '   '],
    ['tabs and newlines', ' \t\n '],
    ['too long', 'x'.repeat(101)],
    ['not a string', 42],
    ['missing', undefined],
  ])('[S2] rejects an invalid name: %s', async (_label, name) => {
    app = createTestApp();
    const res = await app.post('/api/employees', name === undefined ? {} : { name });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(app.db.prepare('SELECT COUNT(*) AS n FROM employees').get()).toEqual({ n: 0 });
  });

  it.each([
    ['only a NUL character', '\u0000'],
    ['a leading NUL', '\u0000Ada'],
    ['an embedded NUL', 'Ada\u0000Lovelace'],
    ['a trailing NUL', 'Ada\u0000'],
    ['another control character', 'Ada\u0001'],
    ['a newline inside', 'Ada\nLovelace'],
  ])('[S2] rejects a name with %s with 400 instead of failing in the database', async (_label, name) => {
    app = createTestApp();
    const res = await app.post('/api/employees', { name });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(app.db.prepare('SELECT COUNT(*) AS n FROM employees').get()).toEqual({ n: 0 });
    expect(app.log.errors).toEqual([]);
  });

  it('accepts names at the length bounds (1 and 100 after trimming)', async () => {
    app = createTestApp();
    expect((await app.post('/api/employees', { name: 'A' })).status).toBe(201);
    expect((await app.post('/api/employees', { name: ` ${'x'.repeat(100)} ` })).status).toBe(201);
  });

  it('[S3] lists all employees sorted by name', async () => {
    app = createTestApp();
    for (const name of ['Charlie Test', 'ada lower', 'Bob Sample']) await app.createEmployee(name);
    const res = await app.get('/api/employees');
    expect(res.status).toBe(200);
    expect(res.body.data.map((e: { name: string }) => e.name)).toEqual(['ada lower', 'Bob Sample', 'Charlie Test']);
  });

  it('[S3] returns an empty list when there are no employees', async () => {
    app = createTestApp();
    expect((await app.get('/api/employees')).body).toEqual({ data: [] });
  });

  it('allows several employees with the same name (FR-EMP-5)', async () => {
    app = createTestApp();
    const a = await app.createEmployee('Alice Smith');
    const b = await app.createEmployee('Alice Smith');
    expect(a.id).not.toBe(b.id);
    expect((await app.get('/api/employees')).body.data).toHaveLength(2);
  });

  it('rejects a body that is not valid JSON with INVALID_JSON', async () => {
    app = createTestApp();
    const res = await app.post('/api/employees', '{"name": ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('rejects an empty body with INVALID_JSON', async () => {
    app = createTestApp();
    const res = await app.post('/api/employees');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('rejects a body larger than 10 KB with PAYLOAD_TOO_LARGE', async () => {
    app = createTestApp();
    const res = await app.post('/api/employees', { name: 'x'.repeat(11 * 1024) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('enforces the size cap on the real stream even when Content-Length is missing', async () => {
    app = createTestApp();
    const big = new Request('http://test/api/employees', { method: 'POST', body: JSON.stringify({ name: 'x'.repeat(11 * 1024) }) });
    big.headers.delete('content-length');
    const res = await employeeHandlers(app.container).create(big);
    expect(res.status).toBe(413);
  });

  it('answers with the error envelope and no-store caching headers', async () => {
    app = createTestApp();
    const res = await app.post('/api/employees', { name: '' });
    expect(res.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: expect.any(String), details: expect.any(Array) },
    });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(req('GET', '/x').method).toBe('GET');
  });
});
