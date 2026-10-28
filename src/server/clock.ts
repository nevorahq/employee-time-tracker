/** All server time comes from a Clock so tests can control it (BR-11). */
export interface Clock {
  /** Milliseconds since the Unix epoch (UTC). */
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };
