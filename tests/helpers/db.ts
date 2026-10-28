import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';

const dirs: string[] = [];

/** A fresh database path inside a temp directory; removed after each test (DB-7). */
export function tmpDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ett-'));
  dirs.push(dir);
  return join(dir, 'nested', 'test.db');
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
