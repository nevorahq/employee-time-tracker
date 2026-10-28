import { timeEntriesQuery } from '../../shared/schemas.ts';
import type { Container } from '../container.ts';
import { json, parseQuery, withErrors } from '../http.ts';

export function timeEntryHandlers(c: Container) {
  return {
    list: withErrors(c.logger, (req: Request) => json(c.history.list(parseQuery(req, timeEntriesQuery)))),
  };
}
