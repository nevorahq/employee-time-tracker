import { parentPort, workerData } from 'node:worker_threads';
import { systemClock } from '../../src/server/clock.ts';
import { createContainer } from '../../src/server/container.ts';
import { openDatabase } from '../../src/server/db/open.ts';
import { timerHandlers } from '../../src/server/handlers/timer.ts';
import { silentLogger } from '../../src/server/logger.ts';

export type Op =
  | { kind: 'start'; employeeId: string; description: string }
  | { kind: 'stop'; id: string }
  // start a timer and, if that succeeds, stop the timer it just created (two results)
  | { kind: 'cycle'; employeeId: string; description: string };
export type WorkerJob = { path: string; flag: SharedArrayBuffer; ops: Op[] };
export type OpResult = { status: number; code?: string };

/**
 * One worker = one independent SQLite connection to the shared file, driven through the real handlers.
 * All workers block on a shared flag so their operations start at the same moment.
 */
const job = workerData as WorkerJob;
const db = openDatabase(job.path);
const handlers = timerHandlers(createContainer({ db, clock: systemClock, logger: silentLogger }));
const flag = new Int32Array(job.flag);

parentPort!.postMessage({ ready: true });
Atomics.wait(flag, 0, 0); // released by the main thread once every worker is ready

const post = (url: string, body?: unknown) =>
  new Request(`http://worker${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

type Body = { data?: { id: string }; error?: { code: string } };

const results: OpResult[] = [];
const record = async (res: Response): Promise<Body> => {
  const body = (await res.json()) as Body;
  results.push({ status: res.status, code: body.error?.code });
  return body;
};
const start = (employeeId: string, description: string) =>
  handlers.start(post('/api/timer/start', { employeeId, description }));
const stop = (id: string) => handlers.stop(post(`/api/timer/${id}/stop`), id);

for (const op of job.ops) {
  if (op.kind === 'start') await record(await start(op.employeeId, op.description));
  else if (op.kind === 'stop') await record(await stop(op.id));
  else {
    const started = await record(await start(op.employeeId, op.description));
    if (started.data) await record(await stop(started.data.id));
  }
}
db.close();
parentPort!.postMessage({ results });
