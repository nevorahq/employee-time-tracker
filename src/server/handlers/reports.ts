import { reportQuery } from '../../shared/schemas.ts';
import type { Container } from '../container.ts';
import { json, parseQuery, withErrors } from '../http.ts';

export function reportHandlers(c: Container) {
  return {
    summary: withErrors(c.logger, (req: Request) => json(c.reports.summary(parseQuery(req, reportQuery)))),
  };
}
