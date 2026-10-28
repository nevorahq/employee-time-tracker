import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from '../../src/client/lib/csv.ts';
import { formatPeriod } from '../../src/client/lib/format.ts';

describe('formatPeriod', () => {
  it('shows start and end times of the same day', () => {
    expect(formatPeriod('2026-10-27T09:00:00.000Z', '2026-10-27T10:30:00.000Z')).toBe('11:00 – 12:30');
  });

  it('marks an entry that ends on a later local day', () => {
    expect(formatPeriod('2026-10-27T20:00:00.000Z', '2026-10-27T23:30:00.000Z')).toBe('22:00 – 01:30 (+1d)');
  });

  it('says "now" for a running entry', () => {
    expect(formatPeriod('2026-10-27T09:00:00.000Z', null)).toBe('11:00 – now');
  });
});

describe('CSV', () => {
  it('quotes cells with commas, quotes and line breaks', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
  });

  it('neutralises spreadsheet formulas', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-2')).toBe("'-2");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('joins rows with CRLF and ends with one', () => {
    expect(toCsv([['a', 'b'], ['c', 'd']])).toBe('a,b\r\nc,d\r\n');
  });
});
