import { Worker } from 'node:worker_threads';
import type { Op, OpResult } from '../workers/timer-worker.ts';

/**
 * Runs each op list in its own worker thread with its own connection to the same database file,
 * releasing them together. Promise.all in one process would prove nothing: better-sqlite3 is synchronous.
 */
export async function runInWorkers(path: string, jobs: Op[][]): Promise<OpResult[][]> {
  const flag = new SharedArrayBuffer(4);
  const flagView = new Int32Array(flag);
  const url = new URL('../workers/timer-worker.ts', import.meta.url);

  let ready = 0;
  const workers: Worker[] = [];
  const done = jobs.map(
    (ops) =>
      new Promise<OpResult[]>((resolve, reject) => {
        const worker = new Worker(url, {
          workerData: { path, flag, ops },
          execArgv: [...process.execArgv, '--experimental-strip-types'],
        });
        workers.push(worker);
        worker.on('message', (msg: { ready?: boolean; results?: OpResult[] }) => {
          if (msg.ready && ++ready === jobs.length) {
            Atomics.store(flagView, 0, 1);
            Atomics.notify(flagView, 0);
          }
          if (msg.results) resolve(msg.results);
        });
        worker.on('error', reject);
        worker.on('exit', (code) => code !== 0 && reject(new Error(`worker exited with code ${code}`)));
      }),
  );

  try {
    return await Promise.all(done);
  } finally {
    await Promise.all(workers.map((w) => w.terminate()));
  }
}

export const tally = (results: OpResult[][]) => {
  const flat = results.flat();
  const by = (pred: (r: OpResult) => boolean) => flat.filter(pred).length;
  return {
    total: flat.length,
    ok: (status: number) => by((r) => r.status === status),
    code: (code: string) => by((r) => r.code === code),
    serverErrors: by((r) => r.status >= 500),
  };
};
