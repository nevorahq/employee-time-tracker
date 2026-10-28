'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { EmployeesSection } from './features/employees/EmployeesSection';
import { HistorySection } from './features/history/HistorySection';
import { ReportsSection } from './features/reports/ReportsSection';
import { TimerSection } from './features/timer/TimerSection';
import { api } from './lib/api-client';
import { employeeLabels } from './lib/format';
import { useResource } from './lib/hooks';

type Toast = { id: number; kind: 'success' | 'error'; text: string };

/** Owns the server data shared by all sections. Nothing business-related is kept in the browser. */
export function TimeTrackerApp() {
  const employees = useResource(api.listEmployees);
  const timers = useResource(api.activeTimers);
  const [revision, setRevision] = useState(0);
  const [toast, setToast] = useState<Toast | null>(null);

  const labels = useMemo(() => employeeLabels(employees.data ?? []), [employees.data]);

  const { reload: reloadEmployees } = employees;
  const { reload: reloadTimers } = timers;
  /** After any mutation, re-read everything from the server (UI-8). */
  const onChanged = useCallback(() => {
    reloadEmployees();
    reloadTimers();
    setRevision((n) => n + 1);
  }, [reloadEmployees, reloadTimers]);

  const notify = useCallback((kind: Toast['kind'], text: string) => setToast({ id: Date.now() + Math.random(), kind, text }), []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <>
      <nav className="nav" aria-label="Sections">
        <a href="#employees">Employees</a>
        <a href="#timer">Active Timer</a>
        <a href="#history">History</a>
        <a href="#reports">Reports</a>
      </nav>

      <EmployeesSection employees={employees} labels={labels} onChanged={onChanged} notify={notify} />
      <TimerSection employees={employees} labels={labels} timers={timers} onChanged={onChanged} notify={notify} />
      <HistorySection
        employees={employees}
        labels={labels}
        serverOffsetMs={timers.data?.serverOffsetMs ?? 0}
        revision={revision}
      />
      <ReportsSection employees={employees} labels={labels} />

      {/* Always mounted so screen readers announce changes (UI-3). */}
      <div className="toast-region" role="status" aria-live="polite">
        {toast && <p key={toast.id} className={`toast toast-${toast.kind}`}>{toast.text}</p>}
      </div>
    </>
  );
}
