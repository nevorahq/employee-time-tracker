'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { EmployeesSection } from './features/employees/EmployeesSection';
import { HistorySection } from './features/history/HistorySection';
import { ReportsSection } from './features/reports/ReportsSection';
import { TimerSection } from './features/timer/TimerSection';
import { ChartIcon, ClockIcon, TimerIcon, UsersIcon } from './components/icons';
import { api } from './lib/api-client';
import { employeeLabels } from './lib/format';
import { useResource, useTimeZone } from './lib/hooks';

type Toast = { id: number; kind: 'success' | 'error'; text: string };

const VIEWS = [
  { id: 'history', label: 'Timesheet', icon: <ClockIcon />, group: 'main' },
  { id: 'timer', label: 'Active Timer', icon: <TimerIcon />, group: 'main' },
  { id: 'reports', label: 'Reports', icon: <ChartIcon />, group: 'main' },
  { id: 'employees', label: 'Employees', icon: <UsersIcon />, group: 'manage' },
] as const;
type ViewId = (typeof VIEWS)[number]['id'];

const viewFromHash = (hash: string): ViewId => VIEWS.find((v) => `#${v.id}` === hash)?.id ?? 'history';

/** Owns the server data shared by all sections. Nothing business-related is kept in the browser. */
export function TimeTrackerApp() {
  const employees = useResource(api.listEmployees);
  const timers = useResource(api.activeTimers);
  const [revision, setRevision] = useState(0);
  const [toast, setToast] = useState<Toast | null>(null);
  const [view, setView] = useState<ViewId>('history');
  const focusTimerForm = useRef(false);
  const timeZone = useTimeZone();

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

  // The page is chosen by the URL hash, so links, reloads and the back button keep working.
  // The server renders the first page; the browser switches after hydration.
  useEffect(() => {
    const sync = () => setView(viewFromHash(window.location.hash));
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  useEffect(() => {
    if (view === 'timer' && focusTimerForm.current) {
      focusTimerForm.current = false;
      document.getElementById('timer-employee')?.focus();
    }
  }, [view]);

  const startTimer = useCallback(() => {
    focusTimerForm.current = true;
    if (window.location.hash === '#timer') setView('timer');
    else window.location.hash = '#timer';
  }, []);

  const runningCount = timers.data?.timers.length ?? 0;
  const navGroup = (group: (typeof VIEWS)[number]['group']): ReactNode =>
    VIEWS.filter((v) => v.group === group).map((v) => (
      <a key={v.id} href={`#${v.id}`} className="nav-link" aria-current={view === v.id ? 'page' : undefined}>
        {v.icon}
        <span>{v.label}</span>
        {v.id === 'timer' && runningCount > 0 && (
          <span className="nav-count">
            {' '}
            {runningCount}
            <span className="sr-only"> running</span>
          </span>
        )}
      </a>
    ));

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <ClockIcon />
          </span>
          <span className="brand-text">
            <span className="brand-name">Time Tracker</span>
            <span className="brand-sub">Local workspace</span>
          </span>
        </div>

        <nav className="nav" aria-label="Sections">
          <div className="nav-group">{navGroup('main')}</div>
          <p className="nav-heading">Manage</p>
          <div className="nav-group">{navGroup('manage')}</div>
        </nav>

        {timeZone && <p className="sidebar-foot">Times shown in {timeZone}</p>}
      </aside>

      <main className="main">
        <h1 className="sr-only">Employee Time Tracker</h1>
        <div className="view" data-active={view === 'history' ? '' : undefined}>
          <HistorySection
            employees={employees}
            labels={labels}
            serverOffsetMs={timers.data?.serverOffsetMs ?? 0}
            revision={revision}
            onStartTimer={startTimer}
          />
        </div>
        <div className="view" data-active={view === 'timer' ? '' : undefined}>
          <TimerSection employees={employees} labels={labels} timers={timers} onChanged={onChanged} notify={notify} />
        </div>
        <div className="view" data-active={view === 'reports' ? '' : undefined}>
          <ReportsSection employees={employees} labels={labels} />
        </div>
        <div className="view" data-active={view === 'employees' ? '' : undefined}>
          <EmployeesSection employees={employees} labels={labels} onChanged={onChanged} notify={notify} />
        </div>
      </main>

      {/* Always mounted so screen readers announce changes (UI-3). */}
      <div className="toast-region" role="status" aria-live="polite">
        {toast && <p key={toast.id} className={`toast toast-${toast.kind}`}>{toast.text}</p>}
      </div>
    </div>
  );
}
