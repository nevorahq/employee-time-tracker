/**
 * The only place where time arithmetic lives (NFR-13).
 * All values are integer milliseconds since the Unix epoch (UTC); nothing is rounded.
 */

/** Part of [start, end) that falls inside the half-open period [from, to). */
export const overlapMs = (start: number, end: number, from: number, to: number): number =>
  Math.max(0, Math.min(end, to) - Math.max(start, from));

/** Elapsed time of a record up to `now`; never negative. */
export const elapsedMs = (startedAt: number, now: number): number => Math.max(0, now - startedAt);
