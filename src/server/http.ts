import type { ZodType } from 'zod';
import { ERROR_STATUS, type ApiErrorBody, type ErrorCode } from '../shared/errors.ts';
import { isBusyError } from './db/sqlite-errors.ts';
import { AppError } from './domain/errors.ts';
import type { Logger } from './logger.ts';

export const MAX_BODY_BYTES = 10 * 1024;

const BASE_HEADERS = { 'Cache-Control': 'no-store' };

export function json<T>(data: T, status = 200): Response {
  return Response.json({ data }, { status, headers: BASE_HEADERS });
}

export function errorResponse(
  code: ErrorCode,
  message: string,
  details?: unknown,
  extraHeaders?: Record<string, string>,
): Response {
  const body: ApiErrorBody = { error: { code, message, ...(details === undefined ? {} : { details }) } };
  return Response.json(body, { status: ERROR_STATUS[code], headers: { ...BASE_HEADERS, ...extraHeaders } });
}

/** Parses `value` with a shared schema; a failure becomes VALIDATION_ERROR with per-field details. */
export function parseWith<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const details = result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
  throw new AppError('VALIDATION_ERROR', details[0]?.message ?? 'The request is invalid.', details);
}

export function parseQuery<T>(req: Request, schema: ZodType<T>): T {
  return parseWith(schema, Object.fromEntries(new URL(req.url).searchParams));
}

/** Reads the body with a hard size cap, then validates it. Never trusts Content-Length alone. */
export async function parseJson<T>(req: Request, schema: ZodType<T>): Promise<T> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new AppError('PAYLOAD_TOO_LARGE');

  const chunks: Uint8Array[] = [];
  let size = 0;
  if (req.body) {
    const reader = req.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new AppError('PAYLOAD_TOO_LARGE');
      }
      chunks.push(value);
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError('INVALID_JSON');
  }
  return parseWith(schema, parsed);
}

/**
 * Central error handling (NFR-3): known failures become their stable code; anything else is logged
 * in full on the server and returned as a generic INTERNAL_ERROR without stack, SQL or paths.
 */
export function withErrors<A extends unknown[]>(
  logger: Logger,
  handler: (...args: A) => Response | Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (err) {
      if (err instanceof AppError) return errorResponse(err.code, err.message, err.details);
      if (isBusyError(err)) {
        logger.warn('Database busy.');
        return errorResponse('DB_BUSY', 'The database is busy. Please retry.', undefined, { 'Retry-After': '1' });
      }
      logger.error('Unhandled error in request handler.', err);
      return errorResponse('INTERNAL_ERROR', 'Internal server error.');
    }
  };
}
