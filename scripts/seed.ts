// Demo data for a fresh database: `npm run seed`. Refuses to run if employees already exist.
import process from 'node:process';
import { databasePath } from '../src/server/config.ts';
import { openDatabase } from '../src/server/db/open.ts';
import { SeedRefusedError, seedDemoData } from '../src/server/seed.ts';

const path = databasePath();
const db = openDatabase(path);
try {
  const summary = seedDemoData(db, Date.now());
  console.log(
    `Seeded ${path}: ${summary.employees} employees, ${summary.finishedEntries} finished entries, ${summary.activeTimers} running timer.`,
  );
} catch (err) {
  if (err instanceof SeedRefusedError) {
    console.error(`${err.message} Nothing was changed.`);
    process.exitCode = 1;
  } else {
    throw err;
  }
} finally {
  db.close();
}
