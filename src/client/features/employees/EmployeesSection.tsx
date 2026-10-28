'use client';

import { useRef, useState, type FormEvent } from 'react';
import { nameSchema } from '@/shared/schemas';
import type { Employee } from '@/shared/types';
import { api } from '../../lib/api-client';
import { formatDateTime } from '../../lib/format';
import type { Resource } from '../../lib/hooks';
import { EmptyState, ErrorState, Field, Loading, Section, messageOf } from '../../components/ui';

type Props = {
  employees: Resource<Employee[]>;
  labels: Map<string, string>;
  onChanged: () => void;
  notify: (kind: 'success' | 'error', text: string) => void;
};

export function EmployeesSection({ employees, labels, onChanged, notify }: Props) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false); // blocks a second submit before React re-renders

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;

    // Same rules as the server (shared schema); the server stays authoritative.
    const parsed = nameSchema.safeParse(name);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter a valid name.');
      return;
    }

    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const created = await api.createEmployee(parsed.data);
      setName('');
      notify('success', `Employee "${created.name}" was added.`);
      onChanged();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <Section id="employees" title="Employees">
      <form className="form-row" onSubmit={submit} noValidate>
        <Field id="employee-name" label="Name" error={error}>
          <input
            id="employee-name"
            name="name"
            type="text"
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'employee-name-error' : undefined}
          />
        </Field>
        <button type="submit" className="btn" disabled={pending}>
          {pending ? 'Adding…' : 'Add employee'}
        </button>
      </form>

      {employees.loading && !employees.data && <Loading label="Loading employees…" />}
      {employees.error && !employees.data && <ErrorState message={messageOf(employees.error)} onRetry={employees.reload} />}
      {employees.data && employees.data.length === 0 && <EmptyState>No employees yet. Add the first one above.</EmptyState>}
      {employees.data && employees.data.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Created</th>
            </tr>
          </thead>
          <tbody>
            {employees.data.map((e) => (
              <tr key={e.id}>
                <td data-label="Name">{labels.get(e.id) ?? e.name}</td>
                <td data-label="Created">{formatDateTime(e.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}
