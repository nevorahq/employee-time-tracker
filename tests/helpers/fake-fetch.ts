import { vi } from 'vitest';

export type FakeRequest = { method: string; path: string; query: URLSearchParams; body: unknown };
export type FakeReply = { status?: number; body: unknown };
export type FakeHandler = (req: FakeRequest) => FakeReply | Promise<FakeReply> | undefined;

export const ok = <T>(data: T, status = 200): FakeReply => ({ status, body: { data } });
export const fail = (status: number, code: string, message: string): FakeReply => ({
  status,
  body: { error: { code, message } },
});

/** Resolvable promise, to hold a request "in flight" while the test inspects the UI. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

/**
 * Replaces the network for the component tests. Business data is never stored here:
 * every test states exactly what the "server" answers.
 */
export function installFakeFetch(handler: FakeHandler = () => undefined) {
  const calls: FakeRequest[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const req: FakeRequest = {
      method: init?.method ?? 'GET',
      path: url.pathname,
      query: url.searchParams,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(req);
    const reply = (await handler(req)) ?? defaultReply(req);
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
  });
  vi.stubGlobal('fetch', fn);
  return { calls, fn, requests: (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path) };
}

function defaultReply(req: FakeRequest): FakeReply {
  if (req.path === '/api/employees' && req.method === 'GET') return ok([]);
  if (req.path === '/api/timer/active') return ok({ timers: [], serverTime: new Date().toISOString() });
  if (req.path === '/api/time-entries') return ok({ entries: [], total: 0 });
  throw new Error(`Unhandled fake request: ${req.method} ${req.path}`);
}
