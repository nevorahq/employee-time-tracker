'use client';

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Employee, TimeEntry, TimeEntryPage } from '@/shared/types';
import { api } from '../../lib/api-client';
import { downloadCsv, toCsv } from '../../lib/csv';
import { dateRangeToInstants, todayLocal } from '../../lib/dates';
import { formatDay, formatDuration, formatPeriod, formatShortDay, labelOf } from '../../lib/format';
import { useNow, useResource, type Resource } from '../../lib/hooks';
import { Avatar, EmptyState, ErrorState, Loading, Section, StatusBadge, messageOf, toneOf } from '../../components/ui';
import {
  CalendarIcon,
  ChevronDownIcon,
  CloseIcon,
  DownloadIcon,
  GridIcon,
  ListIcon,
  PersonIcon,
  PlusIcon,
} from '../../components/icons';

const PAGE_SIZE = 25;
/** The API's largest page: the export reads the whole result in as few requests as possible. */
const EXPORT_PAGE_SIZE = 500;

type GroupBy = 'date' | 'employee' | 'none';
type Layout = 'list' | 'grid';
const GROUP_LABELS: Record<GroupBy, string> = { date: 'Date', employee: 'Employee', none: 'None' };

type Row = { entry: TimeEntry; endMs: number; durationMs: number };
type Group = { key: string; label: string | null; rows: Row[]; totalMs: number };

type Props = {
  employees: Resource<Employee[]>;
  labels: Map<string, string>;
  serverOffsetMs: number;
  /** Bumped after every mutation so the list is re-read from the server (UI-8). */
  revision: number;
  onStartTimer: () => void;
};

function boundsOf(fromDate: string, toDate: string) {
  return {
    from: fromDate ? (dateRangeToInstants(fromDate, fromDate)?.from ?? undefined) : undefined,
    to: toDate ? (dateRangeToInstants(toDate, toDate)?.to ?? undefined) : undefined,
  };
}

/** Time worked; a running entry counts up to `serverNow`. Clamped: a browser clock behind the server's must not make it negative. */
function spanOf(entry: TimeEntry, serverNow: number): Row {
  const endMs = entry.endedAt === null ? serverNow : Date.parse(entry.endedAt);
  const span = endMs - Date.parse(entry.startedAt);
  return { entry, endMs, durationMs: Number.isFinite(span) ? Math.max(0, span) : 0 };
}

/** Groups keep the server's order (newest first); a group sits where its first entry appears. */
function groupRows(rows: Row[], by: GroupBy, labels: Map<string, string>): Group[] {
  if (by === 'none') return [{ key: 'all', label: null, rows, totalMs: rows.reduce((sum, r) => sum + r.durationMs, 0) }];
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const key = by === 'date' ? todayLocal(new Date(row.entry.startedAt)) : row.entry.employeeId;
    let group = groups.get(key);
    if (!group) {
      const label = by === 'date' ? formatDay(row.entry.startedAt) : labelOf(labels, row.entry.employeeId, row.entry.employeeName);
      group = { key, label, rows: [], totalMs: 0 };
      groups.set(key, group);
    }
    group.rows.push(row);
    group.totalMs += row.durationMs;
  }
  return [...groups.values()];
}

export function HistorySection({ employees, labels, serverOffsetMs, revision, onStartTimer }: Props) {
  const [employeeId, setEmployeeId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [offset, setOffset] = useState(0);
  const [groupBy, setGroupBy] = useState<GroupBy>('date');
  const [layout, setLayout] = useState<Layout>('list');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [exportState, setExportState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const exporting = useRef(false); // blocks a second click before React re-renders

  // <input type="date"> also accepts years like 0050 that the range conversion rejects: say so instead of ignoring the bound.
  const invalidDate = (fromDate && !dateRangeToInstants(fromDate, fromDate)) || (toDate && !dateRangeToInstants(toDate, toDate));
  const rangeError = invalidDate
    ? 'Enter valid dates.'
    : fromDate && toDate && fromDate > toDate
      ? 'The start date must not be after the end date.'
      : null;

  const load = useCallback(async (): Promise<TimeEntryPage | null> => {
    void revision; // a new revision means "fetch again"
    if (rangeError) return null;
    return api.listEntries({ employeeId: employeeId || undefined, ...boundsOf(fromDate, toDate), limit: PAGE_SIZE, offset });
  }, [employeeId, fromDate, toDate, offset, rangeError, revision]);
  const page = useResource(load);
  const now = useNow(1000, page.data?.entries.some((e) => e.endedAt === null) ?? false);

  const filtered = Boolean(employeeId || fromDate || toDate);
  const clearFilters = () => {
    setEmployeeId('');
    setFromDate('');
    setToDate('');
    setOffset(0);
  };

  const filterSummary = [
    employeeId ? labelOf(labels, employeeId) : 'All employees',
    fromDate || toDate ? `${fromDate || 'the beginning'} – ${toDate || 'today and later'}` : 'All dates',
  ].join(' · ');

  const total = page.data?.total ?? 0;
  const entries = page.data?.entries ?? [];
  const first = total === 0 ? 0 : offset + 1;
  const last = Math.min(offset + PAGE_SIZE, total);

  const serverNow = now + serverOffsetMs;
  const rows = entries.map((entry) => spanOf(entry, serverNow));
  const partialGroups = total > entries.length; // some of a group's entries may be on another page
  const groups = groupRows(rows, groupBy, labels);
  const showDate = groupBy !== 'date';

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  /** Exports everything the current filters match, not just the page on screen. */
  async function exportCsv() {
    if (exporting.current) return;
    exporting.current = true;
    setExportState({ busy: true, error: null });
    try {
      const all = new Map<string, TimeEntry>(); // by id: an entry added meanwhile can shift later pages
      for (let at = 0; ; at += EXPORT_PAGE_SIZE) {
        const batch = await api.listEntries({
          employeeId: employeeId || undefined,
          ...boundsOf(fromDate, toDate),
          limit: EXPORT_PAGE_SIZE,
          offset: at,
        });
        for (const entry of batch.entries) all.set(entry.id, entry);
        if (batch.entries.length === 0 || at + batch.entries.length >= batch.total) break;
      }
      const exportNow = Date.now() + serverOffsetMs;
      const table = [
        ['Employee', 'Task', 'Start', 'End', 'Duration'],
        ...[...all.values()].map((entry) => [
          labelOf(labels, entry.employeeId, entry.employeeName),
          entry.description,
          entry.startedAt,
          entry.endedAt ?? '',
          formatDuration(spanOf(entry, exportNow).durationMs),
        ]),
      ];
      downloadCsv(`timesheet-${todayLocal()}.csv`, toCsv(table));
      setExportState({ busy: false, error: null });
    } catch (err) {
      setExportState({ busy: false, error: messageOf(err) });
    } finally {
      exporting.current = false;
    }
  }

  const cells = (row: Row) => {
    const { entry, durationMs } = row;
    const who = labelOf(labels, entry.employeeId, entry.employeeName);
    return {
      task: (
        <span className="task">
          <span className={`task-dot tone-${toneOf(entry.employeeId)}`} aria-hidden="true" />
          {entry.description}
        </span>
      ),
      employee: (
        <span className="person">
          <Avatar name={who} seed={entry.employeeId} />
          {who}
        </span>
      ),
      status: <StatusBadge running={entry.endedAt === null} />,
      period: (
        <>
          {formatPeriod(entry.startedAt, entry.endedAt)}
          {showDate && <span className="cell-sub">{formatShortDay(entry.startedAt)}</span>}
        </>
      ),
      logged: <strong>{formatDuration(durationMs)}</strong>,
    };
  };

  const keyOf = (group: Group) => `${groupBy}:${group.key}`;

  const bar = (group: Group): ReactNode => {
    if (group.label === null) return null;
    const key = keyOf(group);
    const isCollapsed = collapsed.has(key);
    const count = group.rows.length;
    return (
      <div className="group-bar">
        <span className="group-title">{group.label}</span>
        <span className="group-count">{count === 1 ? '1 item' : `${count} items`}</span>
        <span className="group-end">
          {partialGroups && <span className="group-note">on this page</span>}
          <span className="group-total">
            <span className="sr-only">Total for {group.label}: </span>
            {formatDuration(group.totalMs)}
          </span>
        </span>
        <button
          type="button"
          className="icon-btn"
          aria-expanded={!isCollapsed}
          aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${group.label}`}
          onClick={() => toggle(key)}
        >
          <ChevronDownIcon />
        </button>
      </div>
    );
  };

  return (
    <Section
      id="history"
      title="Timesheet"
      actions={
        <>
          <div className="segmented" role="group" aria-label="Layout">
            <button type="button" aria-pressed={layout === 'list'} onClick={() => setLayout('list')}>
              <ListIcon />
              List
            </button>
            <button type="button" aria-pressed={layout === 'grid'} onClick={() => setLayout('grid')}>
              <GridIcon />
              Grid
            </button>
          </div>
          <button type="button" className="btn btn-secondary" onClick={exportCsv} disabled={entries.length === 0 || page.loading || exportState.busy}>
            <DownloadIcon />
            {exportState.busy ? 'Exporting…' : 'Export'}
          </button>
          <button type="button" className="btn" onClick={onStartTimer}>
            <PlusIcon />
            Start Timer
          </button>
        </>
      }
    >
      <div className="toolbar">
        <div className="toolbar-left">
          <GroupByMenu value={groupBy} onChange={setGroupBy} />
          {filtered && (
            <div className="chips">
              <span className="chips-label">Filters:</span>
              {employeeId && (
                <Chip
                  label={labelOf(labels, employeeId)}
                  removeLabel="Remove employee filter"
                  onRemove={() => {
                    setEmployeeId('');
                    setOffset(0);
                  }}
                />
              )}
              {(fromDate || toDate) && (
                <Chip
                  label={`${fromDate || '…'} – ${toDate || '…'}`}
                  removeLabel="Remove date filter"
                  onRemove={() => {
                    setFromDate('');
                    setToDate('');
                    setOffset(0);
                  }}
                />
              )}
              <button type="button" className="link-btn" onClick={clearFilters}>
                Clear Filter
              </button>
            </div>
          )}
        </div>

        <form className="toolbar-right" onSubmit={(e) => e.preventDefault()}>
          <div className="control">
            <PersonIcon />
            <label htmlFor="history-employee" className="sr-only">
              Employee
            </label>
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
          </div>
          <div className="control">
            <CalendarIcon />
            <span className="control-prefix" aria-hidden="true">
              From
            </span>
            <label htmlFor="history-from" className="sr-only">
              From date
            </label>
            <input
              id="history-from"
              type="date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                setOffset(0);
              }}
            />
            <span className="control-prefix" aria-hidden="true">
              To
            </span>
            <label htmlFor="history-to" className="sr-only">
              To date (inclusive)
            </label>
            <input
              id="history-to"
              type="date"
              value={toDate}
              aria-invalid={rangeError ? true : undefined}
              aria-describedby={rangeError ? 'history-to-error' : undefined}
              onChange={(e) => {
                setToDate(e.target.value);
                setOffset(0);
              }}
            />
          </div>
        </form>
      </div>
      {exportState.error && (
        <p className="status status-error" role="alert">
          Export failed: {exportState.error}
        </p>
      )}
      {rangeError && (
        <p id="history-to-error" className="field-error" role="alert">
          {rangeError}
        </p>
      )}

      <p className="muted" data-testid="history-filters">
        Showing: {filterSummary}
      </p>

      {page.loading && !page.data && !rangeError && <Loading label="Loading time entries…" />}
      {page.error && <ErrorState message={messageOf(page.error)} onRetry={page.reload} />}
      {page.data && entries.length === 0 && (
        <EmptyState>{filtered ? 'No entries match these filters.' : 'No time entries yet.'}</EmptyState>
      )}
      {entries.length > 0 && (
        <>
          {layout === 'list' ? (
            <table className="table timesheet">
              <thead>
                <tr>
                  <th scope="col">Task</th>
                  <th scope="col">Employee</th>
                  <th scope="col">Status</th>
                  <th scope="col">Time Period</th>
                  <th scope="col">Logged Time</th>
                </tr>
              </thead>
              {groups.map((group) => {
                const isCollapsed = collapsed.has(keyOf(group));
                return (
                  <tbody key={group.key}>
                    {group.label !== null && (
                      <tr className="group-row">
                        <th scope="rowgroup" colSpan={5}>
                          {bar(group)}
                        </th>
                      </tr>
                    )}
                    {!isCollapsed &&
                      group.rows.map((row) => {
                        const c = cells(row);
                        return (
                          <tr key={row.entry.id}>
                            <td data-label="Task">{c.task}</td>
                            <td data-label="Employee">{c.employee}</td>
                            <td data-label="Status">{c.status}</td>
                            <td data-label="Time Period">{c.period}</td>
                            <td data-label="Logged Time">{c.logged}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                );
              })}
            </table>
          ) : (
            <div className="groups">
              {groups.map((group) => {
                const isCollapsed = collapsed.has(keyOf(group));
                return (
                  <Fragment key={group.key}>
                    {bar(group)}
                    {!isCollapsed && (
                      <ul className="card-grid">
                        {group.rows.map((row) => {
                          const c = cells(row);
                          return (
                            <li key={row.entry.id} className="entry-card">
                              <div className="entry-card-top">
                                {c.status}
                                {c.logged}
                              </div>
                              <p className="entry-card-task">{c.task}</p>
                              <div className="entry-card-foot">
                                {c.employee}
                                <span className="muted">{c.period}</span>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </Fragment>
                );
              })}
            </div>
          )}
          <nav className="pager" aria-label="History pages">
            <button type="button" className="btn btn-secondary" disabled={offset === 0 || page.loading} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
              Previous
            </button>
            <span>
              {first}–{last} of {total}
            </span>
            <button type="button" className="btn btn-secondary" disabled={last >= total || page.loading} onClick={() => setOffset(offset + PAGE_SIZE)}>
              Next
            </button>
          </nav>
        </>
      )}
    </Section>
  );
}

function Chip({ label, removeLabel, onRemove }: { label: string; removeLabel: string; onRemove: () => void }) {
  return (
    <span className="chip">
      {label}
      <button type="button" aria-label={removeLabel} onClick={onRemove}>
        <CloseIcon />
      </button>
    </span>
  );
}

/** "Group By Date ▾": a small disclosure menu. Closes on a choice, on Escape and on an outside click. */
function GroupByMenu({ value, onChange }: { value: GroupBy; onChange: (next: GroupBy) => void }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event.type === 'keydown' && (event as KeyboardEvent).key !== 'Escape') return;
      if (event.type === 'pointerdown' && ref.current?.contains(event.target as Node)) return;
      setOpen(false);
      if (event.type === 'keydown') ref.current?.querySelector('summary')?.focus();
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <details ref={ref} className="menu" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="menu-trigger">
        Group By {GROUP_LABELS[value]}
        <ChevronDownIcon />
      </summary>
      <div className="menu-list">
        {(Object.keys(GROUP_LABELS) as GroupBy[]).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            onClick={() => {
              onChange(option);
              setOpen(false);
              ref.current?.querySelector('summary')?.focus(); // the clicked button is about to be hidden
            }}
          >
            {GROUP_LABELS[option]}
          </button>
        ))}
      </div>
    </details>
  );
}
