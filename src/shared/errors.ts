/** Stable, machine-readable API error codes and their HTTP status. */
export const ERROR_STATUS = {
  VALIDATION_ERROR: 400,
  INVALID_JSON: 400,
  INVALID_DATE_RANGE: 400,
  EMPLOYEE_NOT_FOUND: 404,
  TIMER_NOT_FOUND: 404,
  NOT_FOUND: 404,
  TIMER_ALREADY_RUNNING: 409,
  TIMER_ALREADY_STOPPED: 409,
  PAYLOAD_TOO_LARGE: 413,
  INTERNAL_ERROR: 500,
  DATABASE_UNAVAILABLE: 503,
  DB_BUSY: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export type ApiErrorBody = {
  error: { code: ErrorCode; message: string; details?: unknown };
};
