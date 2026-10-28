import { z } from 'zod';

export const NAME_MAX = 100;
export const DESCRIPTION_MAX = 500;
export const HISTORY_DEFAULT_LIMIT = 100;
export const HISTORY_MAX_LIMIT = 500;

/**
 * True if the text contains a C0 control character or DEL. NUL in particular must never reach SQLite:
 * its length() stops at the first NUL, so the CHECK constraints disagree with the schema.
 * `allowed` lists control characters that are fine for the field (e.g. line breaks in a description).
 */
const hasControlChars = (text: string, allowed = ''): boolean =>
  [...text].some((ch) => {
    const code = ch.charCodeAt(0);
    return (code < 0x20 || code === 0x7f) && !allowed.includes(ch);
  });

/** Trimmed first, then length-checked: the same bounds as the CHECK constraints in the database. */
export const nameSchema = z
  .string('Name must be a string.')
  .trim()
  .min(1, 'Name is required.')
  .max(NAME_MAX, `Name must be at most ${NAME_MAX} characters.`)
  .refine((v) => !hasControlChars(v), 'Name must not contain control characters or line breaks.');

export const descriptionSchema = z
  .string('Description must be a string.')
  .trim()
  .min(1, 'Task description is required.')
  .max(DESCRIPTION_MAX, `Description must be at most ${DESCRIPTION_MAX} characters.`)
  .refine((v) => !hasControlChars(v, '\n\r\t'), 'Description must not contain control characters.');

/** UUIDs are case-insensitive; ids are stored lower-case, so normalise before they reach the database. */
export const idSchema = z.uuid('Must be a valid UUID.').transform((id) => id.toLowerCase());

const INSTANT_HELP = 'Must be an ISO 8601 instant with a UTC offset, e.g. 2026-10-28T10:00:00Z or 2026-10-28T12:00:00+02:00.';

/** ISO 8601 instant that carries its own offset; a bare date is ambiguous and rejected. Yields epoch ms. */
export const instantSchema = z.iso
  .datetime({ offset: true, error: INSTANT_HELP })
  .transform((value) => Date.parse(value));

const nonNegativeInt = (label: string) =>
  z
    .string()
    .regex(/^\d+$/, `${label} must be a non-negative integer.`)
    .transform(Number)
    .pipe(z.number().int().safe());

export const createEmployeeBody = z.object({ name: nameSchema });

export const startTimerBody = z.object({ employeeId: idSchema, description: descriptionSchema });

export const activeTimersQuery = z.object({ employeeId: idSchema.optional() });

export const timeEntriesQuery = z.object({
  employeeId: idSchema.optional(),
  from: instantSchema.optional(),
  to: instantSchema.optional(),
  limit: nonNegativeInt('limit')
    .pipe(z.number().min(1, 'limit must be at least 1.').max(HISTORY_MAX_LIMIT, `limit must be at most ${HISTORY_MAX_LIMIT}.`))
    .optional(),
  offset: nonNegativeInt('offset').optional(),
});

export const reportQuery = z.object({
  from: instantSchema,
  to: instantSchema,
  employeeId: idSchema.optional(),
});
