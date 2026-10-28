import { AppError } from './errors.ts';

const HOUR_MS = 3_600_000;
/** 366 days, plus slack for a DST change inside a full-year local range. */
export const MAX_RANGE_MS = 366 * 24 * HOUR_MS + 2 * HOUR_MS;

/** Validates [from, to) when both bounds are known (INVALID_DATE_RANGE). */
export function assertValidRange(from: number | undefined, to: number | undefined): void {
  if (from === undefined || to === undefined) return;
  if (from >= to) {
    throw new AppError('INVALID_DATE_RANGE', '"from" must be earlier than "to".');
  }
  if (to - from > MAX_RANGE_MS) {
    throw new AppError('INVALID_DATE_RANGE', 'The date range must not be longer than 366 days.');
  }
}
