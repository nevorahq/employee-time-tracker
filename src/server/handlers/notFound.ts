import { errorResponse } from '../http.ts';

/** JSON 404 for any unknown /api/* path (never an HTML page). */
export const notFound = (_req: Request): Response => errorResponse('NOT_FOUND', 'Resource not found.');
