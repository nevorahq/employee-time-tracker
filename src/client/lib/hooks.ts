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
 */
export function useResource<T>(load: () => Promise<T>): Resource<T> {
  const [state, setState] = useState<{ data: T | undefined; error: Error | undefined; loading: boolean }>({
    data: undefined,
    error: undefined,
    loading: true,
  });
  const latest = useRef(0);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    const id = ++latest.current;
    let cancelled = false;
    load().then(
      (data) => {
        if (!cancelled && id === latest.current) setState({ data, error: undefined, loading: false });
      },
      (error: unknown) => {
        if (!cancelled && id === latest.current) {
          setState((s) => ({ data: s.data, error: error instanceof Error ? error : new Error(String(error)), loading: false }));
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [load, tick]);

  return { ...state, reload };
}

/** Current time, refreshed every `intervalMs`. Used only for display, never stored (BR-8). */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
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
