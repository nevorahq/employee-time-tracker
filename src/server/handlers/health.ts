import type { HealthStatus } from '../../shared/types.ts';
import type { Container } from '../container.ts';
import { errorResponse, json } from '../http.ts';

export function healthHandlers(c: Container) {
  return {
    /** Runs a real query: "ok" is only reported while the database answers. */
    check: async (_req: Request): Promise<Response> => {
      try {
        c.db.prepare('SELECT 1').get();
        const body: HealthStatus = { status: 'ok', database: 'ok' };
        return json(body);
      } catch (err) {
        c.logger.error('Health check failed.', err);
        return errorResponse('DATABASE_UNAVAILABLE', 'The database is unavailable.');
      }
    },
  };
}
