import { createEmployeeBody } from '../../shared/schemas.ts';
import type { Container } from '../container.ts';
import { json, parseJson, withErrors } from '../http.ts';

export function employeeHandlers(c: Container) {
  return {
    list: withErrors(c.logger, (_req: Request) => json(c.employees.list())),

    create: withErrors(c.logger, async (req: Request) => {
      const body = await parseJson(req, createEmployeeBody);
      return json(c.employees.create(body.name), 201);
    }),
  };
}
