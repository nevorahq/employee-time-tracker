import { describe, expect, it } from 'vitest';
import { overlapMs } from '../../src/server/domain/time.ts';

const H = 3_600_000;
// Period [10:00, 12:00) UTC on 2026-10-28, the examples from the ТЗ (section 6).
const base = Date.parse('2026-10-28T00:00:00Z');
const at = (hour: number) => base + hour * H;
const FROM = at(10);
const TO = at(12);

describe('overlapMs', () => {
  it('[S27] counts only the part after `from` when an entry crosses the start', () => {
    expect(overlapMs(at(9), at(11), FROM, TO)).toBe(1 * H);
  });

  it('[S28] counts only the part before `to` when an entry crosses the end', () => {
    expect(overlapMs(at(11), at(13), FROM, TO)).toBe(1 * H);
  });

  it('[S29] gives 0 for entries entirely outside the period', () => {
    expect(overlapMs(at(6), at(7), FROM, TO)).toBe(0);
    expect(overlapMs(at(14), at(15), FROM, TO)).toBe(0);
  });

  it('[S26] gives 0 for an entry that ends exactly at `from` or starts exactly at `to`', () => {
    expect(overlapMs(at(8), at(10), FROM, TO)).toBe(0);
    expect(overlapMs(at(12), at(13), FROM, TO)).toBe(0);
  });

  it('counts a whole entry that lies inside the period', () => {
    expect(overlapMs(at(10) + 5, at(11), FROM, TO)).toBe(H - 5);
  });

  it('caps an entry that covers the whole period at the period length', () => {
    expect(overlapMs(at(0), at(23), FROM, TO)).toBe(2 * H);
  });

  it('gives 0 for a zero-length entry', () => {
    expect(overlapMs(at(11), at(11), FROM, TO)).toBe(0);
  });

  it('[S30] treats an active entry as ending at evaluatedAt', () => {
    const evaluatedAt = at(11) + 30 * 60_000;
    expect(overlapMs(at(11), evaluatedAt, FROM, TO)).toBe(30 * 60_000);
  });

  it('works in whole milliseconds without rounding', () => {
    expect(overlapMs(FROM + 1, FROM + 2, FROM, TO)).toBe(1);
  });
});
