import { ERROR_STATUS, type ErrorCode } from '../../shared/errors.ts';

const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_ERROR: 'The request is invalid.',
  INVALID_JSON: 'The request body is not valid JSON.',
  INVALID_DATE_RANGE: '"from" must be earlier than "to".',
  EMPLOYEE_NOT_FOUND: 'Employee not found.',
  TIMER_NOT_FOUND: 'Timer not found.',
  NOT_FOUND: 'Resource not found.',
  TIMER_ALREADY_RUNNING: 'This employee already has an active timer.',
  TIMER_ALREADY_STOPPED: 'This timer is already stopped.',
  PAYLOAD_TOO_LARGE: 'The request body is too large.',
  INTERNAL_ERROR: 'Internal server error.',
  DATABASE_UNAVAILABLE: 'The database is unavailable.',
  DB_BUSY: 'The database is busy. Please retry.',
};

/** A business-level failure that maps to a stable API error code. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: unknown;

  constructor(code: ErrorCode, message?: string, details?: unknown) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return ERROR_STATUS[this.code];
  }
}
