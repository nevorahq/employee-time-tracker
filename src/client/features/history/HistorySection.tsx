'use client';

import { useCallback, useState } from 'react';
import type { Employee, TimeEntryPage } from '@/shared/types';
import { api } from '../../lib/api-client';
import { dateRangeToInstants } from '../../lib/dates';
import { formatDateTime, formatDuration, labelOf } from '../../lib/format';
import { useNow, useResource, useTimeZone, type Resource } from '../../lib/hooks';
import { Badge, EmptyState, ErrorState, Field, Loading, Section, messageOf } from '../../components/ui';

const PAGE_SIZE = 25;

type Props = {
  employees: Resource<Employee[]>;
  labels: Map<string, string>;
  serverOffsetMs: number;
  /** Bumped after every mutation so the list is re-read from the server (UI-8). */
  revision: number;
};

export function HistorySection({ employees, labels, serverOffsetMs, revision }: Props) {
  const [employeeId, setEmployeeId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [offset, setOffset] = useState(0);
  const timeZone = useTimeZone();
  const now = useNow();

  const rangeError = fromDate && toDate && fromDate > toDate ? 'The start date must not be after the end date.' : null;

  const load = useCallback(async (): Promise<TimeEntryPage | null> => {
    void revision; // a new revision means "fetch again"
    if (rangeError) return null;
    const range = {
      from: fromDate ? (dateRangeToInstants(fromDate, fromDate)?.from ?? undefined) : undefined,
      to: toDate ? (dateRangeToInstants(toDate, toDate)?.to ?? undefined) : undefined,
    };
    return api.listEntries({ employeeId: employeeId || undefined, ...range, limit: PAGE_SIZE, offset });
  }, [employeeId, fromDate, toDate, offset, rangeError, revision]);
  const page = useResource(load);

  const filterSummary = [
    employeeId ? labelOf(labels, employeeId) : 'All employees',
    fromDate || toDate ? `${fromDate || 'the beginning'} – ${toDate || 'today and later'}` : 'All dates',
    timeZone && `times in ${timeZone}`,
  ]
    .filter(Boolean)
    .join(' · ');

  const total = page.data?.total ?? 0;
  const entries = page.data?.entries ?? [];
  const first = total === 0 ? 0 : offset + 1;
  const last = Math.min(offset + PAGE_SIZE, total);

  return (
    <Section id="history" title="Time Entry History">
      <form className="form-grid" onSubmit={(e) => e.preventDefault()}>
        <Field id="history-employee" label="Employee">
          <select
            id="history-employee"
            value={employeeId}
            onChange={(e) => {
              setEmployeeId(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">All employees</option>
            {employees.data?.map((e) => (
              <option key={e.id} value={e.id}>
                {labelOf(labels, e.id, e.name)}
              </option>
            ))}
          </select>
        </Field>
        <Field id="history-from" label="From date">
          <input
            id="history-from"
            type="date"
            value={fromDate}
            onChange={(e) => {
              setFromDate(e.target.value);
              setOffset(0);
            }}
          />
        </Field>
        <Field id="history-to" label="To date (inclusive)" error={rangeError}>
          <input
            id="history-to"
            type="date"
            value={toDate}
            onChange={(e) => {
              setToDate(e.target.value);
              setOffset(0);
            }}
          />
        </Field>
      </form>

      <p className="muted" data-testid="history-filters">
        Showing: {filterSummary}
      </p>

      {page.loading && !page.data && !rangeError && <Loading label="Loading time entries…" />}
      {page.error && <ErrorState message={messageOf(page.error)} onRetry={page.reload} />}
      {page.data && entries.length === 0 && (
        <EmptyState>{employeeId || fromDate || toDate ? 'No entries match these filters.' : 'No time entries yet.'}</EmptyState>
      )}
      {entries.length > 0 && (
        <>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Employee</th>
                <th scope="col">Task</th>
                <th scope="col">Start</th>
                <th scope="col">End</th>
                <th scope="col">Duration</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((t) => {
                const end = t.endedAt === null ? now + serverOffsetMs : Date.parse(t.endedAt);
                return (
                  <tr key={t.id}>
                    <td data-label="Employee">{labelOf(labels, t.employeeId, t.employeeName)}</td>
                    <td data-label="Task">{t.description}</td>
                    <td data-label="Start">{formatDateTime(t.startedAt)}</td>
                    <td data-label="End">{t.endedAt === null ? <Badge>In progress</Badge> : formatDateTime(t.endedAt)}</td>
                    <td data-label="Duration">{formatDuration(end - Date.parse(t.startedAt))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <nav className="pager" aria-label="History pages">
            <button type="button" className="btn btn-secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
              Previous
            </button>
            <span>
              {first}–{last} of {total}
            </span>
            <button type="button" className="btn btn-secondary" disabled={last >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
              Next
            </button>
          </nav>
        </>
      )}
    </Section>
  );
}
