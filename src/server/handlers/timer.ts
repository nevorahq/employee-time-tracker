import { activeTimersQuery, idSchema, startTimerBody } from '../../shared/schemas.ts';
import type { Container } from '../container.ts';
import { json, parseJson, parseQuery, parseWith, withErrors } from '../http.ts';

export function timerHandlers(c: Container) {
  return {
    active: withErrors(c.logger, (req: Request) => {
      const { employeeId } = parseQuery(req, activeTimersQuery);
      return json(c.timers.active(employeeId));
    }),

    start: withErrors(c.logger, async (req: Request) => {
      const body = await parseJson(req, startTimerBody);
      return json(c.timers.start(body.employeeId, body.description), 201);
    }),

    /** The caller passes the `[id]` path segment; the body is ignored (times come from the server only). */
    stop: withErrors(c.logger, (_req: Request, id: string) => json(c.timers.stop(parseWith(idSchema, id)))),
  };
}
