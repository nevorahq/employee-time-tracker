import type { Employee } from '@/shared/types';

/** H:MM:SS. Whole seconds are shown; totals are never summed from these rounded values. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const dateTime = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});
const timeOnly = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });

/** Local-time formatting (UI-11). */
export const formatDateTime = (iso: string): string => dateTime.format(new Date(iso));
export const formatTime = (iso: string): string => timeOnly.format(new Date(iso));

/**
 * Display names for employees. Names are not unique (FR-EMP-5), so when a name repeats,
 * a short id suffix is added: "Alice Smith · #a1b2".
 */
export function employeeLabels(employees: readonly Pick<Employee, 'id' | 'name'>[]): Map<string, string> {
  const groups = new Map<string, string[]>();
  for (const e of employees) groups.set(e.name, [...(groups.get(e.name) ?? []), e.id]);

  const labels = new Map<string, string>();
  for (const [name, ids] of groups) {
    if (ids.length === 1) {
      labels.set(ids[0]!, name);
      continue;
    }
    // Shortest id prefix (min 4) that is unique within the group.
    let length = 4;
    while (length < 36 && new Set(ids.map((id) => id.slice(0, length))).size < ids.length) length += 1;
    for (const id of ids) labels.set(id, `${name} · #${id.slice(0, length)}`);
  }
  return labels;
}

export const labelOf = (labels: Map<string, string>, id: string, fallback = 'Unknown employee'): string =>
  labels.get(id) ?? fallback;
