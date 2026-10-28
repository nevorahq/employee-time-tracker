import { describe, expect, it } from 'vitest';
import {
  daysBetweenInclusive,
  dateRangeToInstants,
  startOfLocalDay,
  startOfNextLocalDay,
  todayLocal,
} from '../../src/client/lib/dates.ts';
import { employeeLabels, formatDuration } from '../../src/client/lib/format.ts';

const HOUR = 3_600_000;
const dayLengthHours = (date: string) =>
  (Date.parse(startOfNextLocalDay(date)!) - Date.parse(startOfLocalDay(date)!)) / HOUR;

describe('test environment', () => {
  it('runs in the fixed time zone Europe/Chisinau', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Europe/Chisinau');
  });
});

describe('local calendar dates to instants', () => {
  it('[S26] makes the end date inclusive: `to` is local midnight of the next day', () => {
    // Oct 24 is still summer time (UTC+3); from Oct 25 03:00 local time it is UTC+2.
    expect(dateRangeToInstants('2026-10-24', '2026-10-25')).toEqual({
      from: '2026-10-23T21:00:00.000Z', // Oct 24 00:00 (+03:00)
      to: '2026-10-25T22:00:00.000Z', // Oct 26 00:00 (+02:00)
    });
  });

  it('[S26] a one-day range spans exactly that local day', () => {
    const range = dateRangeToInstants('2026-10-28', '2026-10-28')!;
    expect(range.from).toBe('2026-10-27T22:00:00.000Z');
    expect(range.to).toBe('2026-10-28T22:00:00.000Z');
  });

  it('a normal day is 24 hours', () => {
    expect(dayLengthHours('2026-10-28')).toBe(24);
  });

  it('the day summer time starts (2026-03-29) is 23 hours long', () => {
    expect(dayLengthHours('2026-03-29')).toBe(23);
  });

  it('the day summer time ends (2026-10-25) is 25 hours long', () => {
    expect(dayLengthHours('2026-10-25')).toBe(25);
  });

  it('crosses a DST change without shifting the calendar boundaries', () => {
    const range = dateRangeToInstants('2026-03-28', '2026-03-30')!;
    expect((Date.parse(range.to) - Date.parse(range.from)) / HOUR).toBe(3 * 24 - 1);
  });

  it.each(['', 'yesterday', '2026-02-30', '2026-13-01', '28.10.2026', '2026-1-1'])('rejects %j', (value) => {
    expect(startOfLocalDay(value)).toBeNull();
    expect(dateRangeToInstants(value, '2026-10-28')).toBeNull();
  });

  it('counts days inclusively', () => {
    expect(daysBetweenInclusive('2026-10-28', '2026-10-28')).toBe(1);
    expect(daysBetweenInclusive('2026-01-01', '2026-12-31')).toBe(365);
    expect(daysBetweenInclusive('2026-03-28', '2026-03-30')).toBe(3);
  });

  it('formats today as a local calendar date', () => {
    expect(todayLocal(new Date(2026, 9, 5, 23, 59))).toBe('2026-10-05');
  });
});

describe('formatDuration', () => {
  it.each([
    [0, '0:00:00'],
    [999, '0:00:00'],
    [1000, '0:00:01'],
    [61_000, '0:01:01'],
    [3_600_000, '1:00:00'],
    [90 * 60_000, '1:30:00'],
    [100 * HOUR + 5_000, '100:00:05'],
    [-5000, '0:00:00'],
  ])('%d ms -> %s', (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });
});

describe('employeeLabels (FR-EMP-5)', () => {
  it('keeps unique names as they are', () => {
    const labels = employeeLabels([{ id: 'aaaa-1', name: 'Ada' }, { id: 'bbbb-2', name: 'Bob' }]);
    expect([...labels.values()]).toEqual(['Ada', 'Bob']);
  });

  it('adds a short id suffix only to repeated names', () => {
    const labels = employeeLabels([
      { id: 'a1b2c3d4', name: 'Alice Smith' },
      { id: 'e5f6a7b8', name: 'Alice Smith' },
      { id: 'c0ffee00', name: 'Bob' },
    ]);
    expect(labels.get('a1b2c3d4')).toBe('Alice Smith · #a1b2');
    expect(labels.get('e5f6a7b8')).toBe('Alice Smith · #e5f6');
    expect(labels.get('c0ffee00')).toBe('Bob');
  });

  it('lengthens the suffix when the first characters collide', () => {
    const labels = employeeLabels([
      { id: 'abcd1111', name: 'Sam' },
      { id: 'abcd2222', name: 'Sam' },
    ]);
    expect(labels.get('abcd1111')).toBe('Sam · #abcd1');
    expect(labels.get('abcd2222')).toBe('Sam · #abcd2');
  });
});
