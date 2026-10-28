import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

export type Resource<T> = {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  reload: () => void;
};

/**
 * Loads data on mount and whenever `load` changes (make it stable with useCallback).
 * Out-of-order responses are ignored, so a slow old request cannot overwrite a newer one.
 * Old data stays visible while a refetch runs; `loading` is true until the response for the current `load` arrives.
 */
export function useResource<T>(load: () => Promise<T>): Resource<T> {
  const [state, setState] = useState<{
    data: T | undefined;
    error: Error | undefined;
    /** Which request the data answers; `null` until the first one settles. */
    settled: { load: () => Promise<T>; tick: number } | null;
  }>({ data: undefined, error: undefined, settled: null });
  const latest = useRef(0);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    const id = ++latest.current;
    let cancelled = false;
    const settled = { load, tick };
    load().then(
      (data) => {
        if (!cancelled && id === latest.current) setState({ data, error: undefined, settled });
      },
      (error: unknown) => {
        if (!cancelled && id === latest.current) {
          setState((s) => ({ data: s.data, error: error instanceof Error ? error : new Error(String(error)), settled }));
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [load, tick]);

  const loading = state.settled === null || state.settled.load !== load || state.settled.tick !== tick;
  return { data: state.data, error: state.error, loading, reload };
}

/**
 * Current time, refreshed every `intervalMs` while `enabled`. Used only for display, never stored (BR-8).
 * Turn it off when nothing on screen depends on the clock, so the page is not re-rendered for nothing.
 */
export function useNow(intervalMs = 1000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const tick = () => setNow(Date.now());
    const catchUp = setTimeout(tick, 0); // the clock may be stale after a pause
    const timer = setInterval(tick, intervalMs);
    return () => {
      clearTimeout(catchUp);
      clearInterval(timer);
    };
  }, [intervalMs, enabled]);
  return now;
}

const noopSubscribe = () => () => {};

/** Browser time zone; empty on the server so server and client markup match during hydration. */
export function useTimeZone(): string {
  return useSyncExternalStore(
    noopSubscribe,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => '',
  );
}
