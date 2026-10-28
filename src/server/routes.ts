import { getContainer, type Container } from './container.ts';
import { errorResponse } from './http.ts';
import { consoleLogger } from './logger.ts';

/**
 * Binds a handler factory to the process-wide container for one route.
 * If the database cannot be opened at all, the request still gets the JSON error contract
 * (503 DATABASE_UNAVAILABLE) instead of an unhandled exception. A failed open is not cached,
 * so the next request retries and the service recovers once the problem is fixed.
 */
export function route<A extends unknown[]>(
  build: (container: Container) => (...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args) => {
    let container: Container;
    try {
      container = getContainer();
    } catch (err) {
      consoleLogger.error('Cannot open the database.', err);
      return errorResponse('DATABASE_UNAVAILABLE', 'The database is unavailable.');
    }
    return build(container)(...args);
  };
}
