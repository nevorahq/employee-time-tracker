// Process-level smoke test over `next start`: checks route wiring and a genuine hard restart.
//   npm run build && npm run test:e2e
// An active timer must survive `kill -9` of the server with its original id and startedAt.
import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = new URL('../../', import.meta.url).pathname;
const NEXT_BIN = join(ROOT, 'node_modules/next/dist/bin/next');

if (!existsSync(join(ROOT, '.next/BUILD_ID'))) {
  console.error('No production build found. Run `npm run build` first.');
  process.exit(2);
}

const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

const dir = mkdtempSync(join(tmpdir(), 'ett-smoke-'));
const dbPath = join(dir, 'data', 'smoke.db');
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
let server = null;
let serverOutput = '';
let passed = 0;

function check(condition, message) {
  if (!condition) throw new Error(`FAILED: ${message}`);
  passed += 1;
  console.log(`  ok  ${message}`);
}

function startServer() {
  const child = spawn(process.execPath, [NEXT_BIN, 'start', '-H', '127.0.0.1', '-p', String(port)], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_PATH: dbPath, NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => (serverOutput += d));
  child.stderr.on('data', (d) => (serverOutput += d));
  child.exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  return child;
}

async function waitFor(predicate, what, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate().catch(() => false)) return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

const up = () => fetch(`${base}/api/health`).then((r) => r.ok);
const down = () => fetch(`${base}/api/health`).then(() => false, () => true);

async function api(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${method} ${path} returned non-JSON (${res.status}): ${text.slice(0, 120)}`);
  }
  return { status: res.status, json, headers: res.headers };
}

async function hardKill() {
  server.kill('SIGKILL'); // no shutdown hook gets a chance to run
  const { signal } = await server.exited;
  check(signal === 'SIGKILL', 'server process was killed with SIGKILL');
  await waitFor(down, 'the port to be released');
}

try {
  console.log(`Starting next start on ${base} with a temporary database`);
  server = startServer();
  await waitFor(up, 'the server to become healthy');

  console.log('Route wiring');
  const health = await api('GET', '/api/health');
  check(health.status === 200 && health.json.data.database === 'ok', 'GET /api/health -> 200 database ok');
  check(health.headers.get('cache-control') === 'no-store', 'responses are not cacheable');
  check((await api('GET', '/api/employees')).json.data.length === 0, 'GET /api/employees -> empty list on a clean database');
  const unknown = await api('GET', '/api/does-not-exist');
  check(unknown.status === 404 && unknown.json.error.code === 'NOT_FOUND', 'unknown /api path -> JSON 404 NOT_FOUND');
  const badJson = await fetch(`${base}/api/employees`, { method: 'POST', body: '{nope' });
  check((await badJson.json()).error.code === 'INVALID_JSON', 'invalid JSON body -> INVALID_JSON');
  const badName = await api('POST', '/api/employees', { name: '   ' });
  check(badName.status === 400 && badName.json.error.code === 'VALIDATION_ERROR', 'blank name -> 400 VALIDATION_ERROR');
  const range = await api('GET', '/api/reports/summary?from=2026-10-28T10:00:00Z&to=2026-10-28T09:00:00Z');
  check(range.json.error?.code === 'INVALID_DATE_RANGE', 'reversed range -> INVALID_DATE_RANGE');
  const emptyReport = await api('GET', `/api/reports/summary?${new URLSearchParams({ from: '2026-01-01T00:00:00Z', to: '2026-01-02T00:00:00Z' })}`);
  check(emptyReport.status === 200 && emptyReport.json.data.totals.totalMs === 0, 'empty report -> 200 with zeros');
  check((await api('GET', '/api/time-entries')).json.data.total === 0, 'GET /api/time-entries -> total 0');

  console.log('Start a timer');
  const ada = (await api('POST', '/api/employees', { name: 'Ada Example' })).json.data;
  const started = await api('POST', '/api/timer/start', { employeeId: ada.id, description: 'Smoke test task' });
  check(started.status === 201 && started.json.data.endedAt === null, 'POST /api/timer/start -> 201 active');
  const second = await api('POST', '/api/timer/start', { employeeId: ada.id, description: 'again' });
  check(second.status === 409 && second.json.error.code === 'TIMER_ALREADY_RUNNING', 'second start -> 409 TIMER_ALREADY_RUNNING');
  const timer = started.json.data;
  check((await api('GET', '/api/timer/active')).json.data.timers.length === 1, 'GET /api/timer/active shows the timer (not served from a cache)');

  console.log('Hard restart (kill -9)');
  await hardKill();
  await sleep(1500); // the server is down for a moment
  server = startServer();
  await waitFor(up, 'the restarted server to become healthy');

  const recovered = (await api('GET', '/api/timer/active')).json.data;
  check(recovered.timers.length === 1, 'exactly one active timer after the restart');
  check(recovered.timers[0].id === timer.id, 'same timer id after the restart');
  check(recovered.timers[0].startedAt === timer.startedAt, 'original startedAt is preserved');
  check(recovered.timers[0].endedAt === null, 'timer is still running');
  check(Date.parse(recovered.serverTime) - Date.parse(timer.startedAt) >= 1500, 'elapsed time includes the downtime');
  const employeesAfter = (await api('GET', '/api/employees')).json.data;
  check(employeesAfter.length === 1 && employeesAfter[0].id === ada.id, 'employees survived the restart');

  console.log('Stop the recovered timer');
  const stopped = await api('POST', `/api/timer/${timer.id}/stop`);
  check(stopped.status === 200 && stopped.json.data.id === timer.id, 'stop -> 200 on the recovered timer');
  check(Date.parse(stopped.json.data.endedAt) >= Date.parse(timer.startedAt), 'endedAt >= startedAt');
  const again = await api('POST', `/api/timer/${timer.id}/stop`);
  check(again.status === 409 && again.json.error.code === 'TIMER_ALREADY_STOPPED', 'repeated stop -> 409 TIMER_ALREADY_STOPPED');
  check((await api('GET', '/api/timer/active')).json.data.timers.length === 0, 'no active timers left');
  const history = (await api('GET', '/api/time-entries')).json.data;
  check(history.total === 1 && history.entries[0].id === timer.id, 'history has the single original entry');

  console.log('Database state');
  await hardKill();
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare('SELECT id, started_at, ended_at FROM time_entries').all();
  db.close();
  check(rows.length === 1, 'exactly one time_entries row in the database file');
  check(rows[0].id === timer.id && rows[0].ended_at >= rows[0].started_at, 'the original row got its endedAt');

  console.log(`\nSmoke test passed (${passed} checks).`);
} catch (err) {
  console.error(`\n${err.message}`);
  console.error('--- server output ---\n' + serverOutput.slice(-2000));
  process.exitCode = 1;
} finally {
  if (server && server.exitCode === null && server.signalCode === null) server.kill('SIGKILL');
  rmSync(dir, { recursive: true, force: true });
}
