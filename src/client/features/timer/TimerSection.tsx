'use client';

import { useRef, useState, type FormEvent } from 'react';
import { descriptionSchema } from '@/shared/schemas';
import type { Employee } from '@/shared/types';
import { api, type ActiveTimersSnapshot } from '../../lib/api-client';
import { formatDateTime, formatDuration, labelOf } from '../../lib/format';
import { useNow, type Resource } from '../../lib/hooks';
import { PlayIcon, StopIcon } from '../../components/icons';
import { Avatar, Badge, EmptyState, ErrorState, Field, Loading, Section, messageOf } from '../../components/ui';

const LONG_RUNNING_MS = 12 * 3_600_000;

type Props = {
  employees: Resource<Employee[]>;
  labels: Map<string, string>;
  timers: Resource<ActiveTimersSnapshot>;
  onChanged: () => void;
  notify: (kind: 'success' | 'error', text: string) => void;
};

export function TimerSection({ employees, labels, timers, onChanged, notify }: Props) {
  const [employeeId, setEmployeeId] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<{ employee?: string; description?: string; form?: string }>({});
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState<ReadonlySet<string>>(new Set());
  const startInFlight = useRef(false);
  const stopInFlight = useRef(new Set<string>());
  const now = useNow();

  const offset = timers.data?.serverOffsetMs ?? 0;
  const active = timers.data?.timers ?? [];
  const alreadyRunning = employeeId !== '' && active.some((t) => t.employeeId === employeeId);

  async function start(event: FormEvent) {
    event.preventDefault();
    if (startInFlight.current) return;

    const next: typeof errors = {};
    if (!employeeId) next.employee = 'Select an employee.';
    const parsed = descriptionSchema.safeParse(description);
    if (!parsed.success) next.description = parsed.error.issues[0]?.message ?? 'Enter a task description.';
    setErrors(next);
    if (next.employee || next.description || !parsed.success) return;

    startInFlight.current = true;
    setStarting(true);
    try {
      await api.startTimer(employeeId, parsed.data);
      setDescription('');
      notify('success', `Timer started for ${labelOf(labels, employeeId)}.`);
    } catch (err) {
      setErrors({ form: messageOf(err) });
    } finally {
      startInFlight.current = false;
      setStarting(false);
      onChanged(); // always re-read the server state, even after a conflict (UI-8)
    }
  }

  async function stop(id: string, who: string) {
    if (stopInFlight.current.has(id)) return;
    stopInFlight.current.add(id);
    setStopping(new Set(stopInFlight.current));
    try {
      await api.stopTimer(id);
      notify('success', `Timer stopped for ${who}.`);
    } catch (err) {
      notify('error', messageOf(err));
    } finally {
      stopInFlight.current.delete(id);
      setStopping(new Set(stopInFlight.current));
      onChanged();
    }
  }

  return (
    <Section id="timer" title="Active Timer" lead="Start a timer for a task and stop it when the work is done.">
      <form className="form-grid panel" onSubmit={start} noValidate>
        <Field id="timer-employee" label="Employee" error={errors.employee}>
          <select
            id="timer-employee"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            disabled={!employees.data || employees.data.length === 0}
            aria-invalid={errors.employee ? true : undefined}
          >
            <option value="">Select an employee…</option>
            {employees.data?.map((e) => (
              <option key={e.id} value={e.id}>
                {labelOf(labels, e.id, e.name)}
              </option>
            ))}
          </select>
        </Field>
        <Field id="timer-description" label="Task description" error={errors.description}>
          <input
            id="timer-description"
            type="text"
            autoComplete="off"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            aria-invalid={errors.description ? true : undefined}
          />
        </Field>
        <button type="submit" className="btn" disabled={starting || alreadyRunning}>
          <PlayIcon />
          {starting ? 'Starting…' : 'Start'}
        </button>
      </form>

      {alreadyRunning && (
        <p className="status status-warn" role="status">
          {labelOf(labels, employeeId)} already has an active timer. Stop it before starting a new one.
        </p>
      )}
      {errors.form && (
        <p className="status status-error" role="alert">
          {errors.form}
        </p>
      )}

      <h3 className="subhead">Running now</h3>
      {timers.loading && !timers.data && <Loading label="Loading active timers…" />}
      {timers.error && !timers.data && <ErrorState message={messageOf(timers.error)} onRetry={timers.reload} />}
      {timers.data && active.length === 0 && <EmptyState>No timers are running.</EmptyState>}
      {active.length > 0 && (
        <ul className="timer-list">
          {active.map((t) => {
            const elapsed = Math.max(0, now + offset - Date.parse(t.startedAt));
            const who = labelOf(labels, t.employeeId, t.employeeName);
            return (
              <li key={t.id} className="timer-item">
                <div className="timer-info">
                  <p className="timer-who">
                    <Avatar name={who} seed={t.employeeId} />
                    {who}
                  </p>
                  <p>{t.description}</p>
                  <p className="muted">Started {formatDateTime(t.startedAt)}</p>
                  {elapsed > LONG_RUNNING_MS && (
                    <p>
                      <Badge tone="warn">Running for over 12 hours — did you forget to stop it?</Badge>
                    </p>
                  )}
                </div>
                <p className="timer-elapsed" aria-label={`Elapsed time for ${who}`}>
                  {formatDuration(elapsed)}
                </p>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => stop(t.id, who)}
                  disabled={stopping.has(t.id)}
                  aria-label={`Stop timer for ${who}`}
                >
                  <StopIcon />
                  {stopping.has(t.id) ? 'Stopping…' : 'Stop'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
