/** Read lazily so tests and tooling can set the environment first. Never exposed to the client. */
export const DEFAULT_DATABASE_PATH = './data/time-tracker.db';

export function databasePath(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.DATABASE_PATH?.trim();
  return value ? value : DEFAULT_DATABASE_PATH;
}
