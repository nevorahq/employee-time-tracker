import { randomUUID } from 'node:crypto';
import type { Clock } from '../clock.ts';
import { toEmployeeDto } from '../domain/dto.ts';
import type { EmployeeRepo } from '../repositories/employees.ts';
import type { Employee } from '../../shared/types.ts';

export function createEmployeeService(repo: EmployeeRepo, clock: Clock) {
  return {
    list: (): Employee[] => repo.list().map(toEmployeeDto),

    /** `name` is already trimmed and length-checked by the shared schema. */
    create(name: string): Employee {
      return toEmployeeDto(repo.insert({ id: randomUUID(), name, createdAt: clock.now() }));
    },
  };
}

export type EmployeeService = ReturnType<typeof createEmployeeService>;
