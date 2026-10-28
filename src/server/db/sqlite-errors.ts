/** better-sqlite3 errors carry a string `code` such as SQLITE_CONSTRAINT_UNIQUE. */
export function sqliteCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null || !('code' in err)) return undefined;
  const { code } = err as { code: unknown };
  return typeof code === 'string' && code.startsWith('SQLITE_') ? code : undefined;
}

export const isSqliteError = (err: unknown, code: string): boolean => sqliteCode(err) === code;

/** The database stayed locked longer than busy_timeout (BR-10). */
export const isBusyError = (err: unknown): boolean => {
  const code = sqliteCode(err);
  return code !== undefined && (code.startsWith('SQLITE_BUSY') || code.startsWith('SQLITE_LOCKED'));
};
