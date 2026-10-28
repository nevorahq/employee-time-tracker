// Fails unless every scenario S1..S32 from the ТЗ (section 11) appears in a test name.
// Tests are tagged "[S7]" or, for a range of steps in one test, "[S13-S21]".
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const TOTAL = 32;
const ROOTS = ['tests', 'src'];
const TEST_FILE = /\.test\.(ts|tsx)$/;
// A tag only counts inside a quoted string (a test or describe name), not in a comment.
const STRING_WITH_TAG = /(['"`])((?:(?!\1)[^\n\\]|\\.)*?\[S\d+(?:-S\d+)?\](?:(?!\1)[^\n\\]|\\.)*)\1/g;
const TAG = /\[S(\d+)(?:-S(\d+))?\]/g;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name === 'node_modules') continue;
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (TEST_FILE.test(name)) yield full;
  }
}

const covered = new Map(); // scenario number -> files
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const source = readFileSync(file, 'utf8');
    for (const [, , text] of source.matchAll(STRING_WITH_TAG)) {
      for (const [, from, to] of text.matchAll(TAG)) {
        const last = to === undefined ? Number(from) : Number(to);
        for (let n = Number(from); n <= last; n++) {
          if (!covered.has(n)) covered.set(n, new Set());
          covered.get(n).add(file);
        }
      }
    }
  }
}

const missing = [];
for (let n = 1; n <= TOTAL; n++) if (!covered.has(n)) missing.push(`S${n}`);
const unknown = [...covered.keys()].filter((n) => n < 1 || n > TOTAL).map((n) => `S${n}`);

if (missing.length || unknown.length) {
  if (missing.length) console.error(`Scenarios without a test: ${missing.join(', ')}`);
  if (unknown.length) console.error(`Tests tagged with unknown scenarios: ${unknown.join(', ')}`);
  process.exit(1);
}
console.log(`All ${TOTAL} scenarios (S1-S${TOTAL}) are covered by tagged tests.`);
