/** Cells that a spreadsheet would run as a formula get a leading apostrophe (CSV injection). */
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export const toCsv = (rows: readonly (readonly string[])[]): string =>
  rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';

/** Byte order mark: keeps Excel from mangling non-ASCII names. */
const BOM = '﻿';

/** Hands `text` to the browser as a file download. */
export function downloadCsv(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([BOM, text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoking right away can cancel the download in Safari and some Firefox versions.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
