'use client';

import { useRef, useState, type FormEvent } from 'react';
import type { Employee, Report } from '@/shared/types';
import { api } from '../../lib/api-client';
import { MAX_RANGE_DAYS, daysBetweenInclusive, dateRangeToInstants, todayLocal } from '../../lib/dates';
import { formatDateTime, formatDuration, formatTime, labelOf } from '../../lib/format';
import { useTimeZone, type Resource } from '../../lib/hooks';
import { Badge, EmptyState, Field, Section, messageOf } from '../../components/ui';

type Props = { employees: Resource<Employee[]>; labels: Map<string, string> };

export function ReportsSection({ employees, labels }: Props) {
  const [startDate, setStartDate] = useState(() => todayLocal());
  const [endDate, setEndDate] = useState(() => todayLocal());
  const [employeeId, setEmployeeId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const timeZone = useTimeZone();

  async function run(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;

    if (!startDate || !endDate) return setError('Choose both a start and an end date.');
    if (startDate > endDate) return setError('The start date must not be after the end date.');
    if (daysBetweenInclusive(startDate, endDate) > MAX_RANGE_DAYS) return setError(`Choose a range of at most ${MAX_RANGE_DAYS} days.`);
    const range = dateRangeToInstants(startDate, endDate);
    if (!range) return setError('Enter valid dates.');

    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      setReport(await api.report({ ...range, employeeId: employeeId || undefined }));
    } catch (err) {
      setError(messageOf(err));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <Section id="reports" title="Reports">
      <form className="form-grid form-grid-4" onSubmit={run} noValidate>
        <Field id="report-from" label="Start date">
          <input id="report-from" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </Field>
        <Field id="report-to" label="End date (inclusive)">
          <input id="report-to" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </Field>
        <Field id="report-employee" label="Employee">
          <select id="report-employee" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">All</option>
            {employees.data?.map((e) => (
              <option key={e.id} value={e.id}>
                {labelOf(labels, e.id, e.name)}
              </option>
            ))}
          </select>
        </Field>
        <button type="submit" className="btn" disabled={pending}>
          {pending ? 'Running…' : 'Run report'}
        </button>
      </form>
      <p className="muted">Dates are interpreted in your time zone{timeZone ? `: ${timeZone}` : ''}.</p>
      {error && (
        <p className="status status-error" role="alert">
          {error}
        </p>
      )}

      {report && <ReportResult report={report} labels={labels} />}
    </Section>
  );
}

function ReportResult({ report, labels }: { report: Report; labels: Map<string, string> }) {
  const hasProvisional = report.totals.provisionalMs > 0;
  return (
    <div aria-live="polite">
      <h3>Result</h3>
      {report.entries.length === 0 ? (
        <EmptyState>No time was recorded in this period. Total: {formatDuration(0)}.</EmptyState>
      ) : (
        <>
          <dl className="totals">
            <div>
              <dt>Total</dt>
              <dd data-testid="report-total">{formatDuration(report.totals.totalMs)}</dd>
            </div>
            <div>
              <dt>Finished</dt>
              <dd>{formatDuration(report.totals.finalizedMs)}</dd>
            </div>
            <div>
              <dt>In progress</dt>
              <dd>{formatDuration(report.totals.provisionalMs)}</dd>
            </div>
          </dl>
          {hasProvisional && (
            <p className="muted">
              Includes time of running timers up to {formatTime(report.evaluatedAt)} (provisional).
            </p>
          )}

          <h3>By employee</h3>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Employee</th>
                <th scope="col">Entries</th>
                <th scope="col">Finished</th>
                <th scope="col">In progress</th>
                <th scope="col">Total</th>
              </tr>
            </thead>
            <tbody>
              {report.employees.map((e) => (
                <tr key={e.employeeId}>
                  <td data-label="Employee">{labelOf(labels, e.employeeId, e.name)}</td>
                  <td data-label="Entries">{e.entryCount}</td>
                  <td data-label="Finished">{formatDuration(e.finalizedMs)}</td>
                  <td data-label="In progress">{formatDuration(e.provisionalMs)}</td>
                  <td data-label="Total">{formatDuration(e.totalMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>Entries in the period</h3>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Employee</th>
                <th scope="col">Task</th>
                <th scope="col">Start</th>
                <th scope="col">End</th>
                <th scope="col">Counted</th>
              </tr>
            </thead>
            <tbody>
              {report.entries.map((e) => (
                <tr key={e.id}>
                  <td data-label="Employee">{labelOf(labels, e.employeeId, e.employeeName)}</td>
                  <td data-label="Task">{e.description}</td>
                  <td data-label="Start">{formatDateTime(e.startedAt)}</td>
                  <td data-label="End">
                    {e.isActive ? (
                      <>
                        <Badge>In progress</Badge> <span className="muted">as of {formatTime(report.evaluatedAt)}</span>
                      </>
                    ) : (
                      formatDateTime(e.endedAt as string)
                    )}
                  </td>
                  <td data-label="Counted">{formatDuration(e.contributionMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
