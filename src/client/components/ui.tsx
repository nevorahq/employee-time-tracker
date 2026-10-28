import type { ReactNode } from 'react';

export const messageOf = (err: unknown): string =>
  err instanceof Error && err.message ? err.message : 'Something went wrong. Please try again.';

type SectionProps = { id: string; title: string; lead?: string; actions?: ReactNode; children: ReactNode };

/** One page of the app: a big title, an optional one-line lead and a slot for header actions. */
export function Section({ id, title, lead, actions, children }: SectionProps) {
  return (
    <section id={id} className="page" aria-labelledby={`${id}-title`}>
      <header className="page-head">
        <div>
          <h2 id={`${id}-title`} className="page-title">
            {title}
          </h2>
          {lead && <p className="page-lead">{lead}</p>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

const TONES = 6;

/** A stable colour index (0..5) for an id, shared by avatars and task dots. */
export function toneOf(seed: string): number {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % TONES;
}

/** Initials on a stable colour; purely decorative, the name is always printed next to it. */
export function Avatar({ name, seed }: { name: string; seed: string }) {
  const initials =
    name
      .split(/\s+/)
      .filter((word) => /^[\p{L}\p{N}]/u.test(word))
      .slice(0, 2)
      .map((word) => Array.from(word)[0])
      .join('')
      .toUpperCase() || '?';
  return (
    <span className={`avatar tone-${toneOf(seed)}`} aria-hidden="true">
      {initials}
    </span>
  );
}

export function StatusBadge({ running }: { running: boolean }) {
  return (
    <span className={`status-badge ${running ? 'status-badge-running' : 'status-badge-done'}`}>
      <span className="status-dot" aria-hidden="true" />
      {running ? 'In progress' : 'Completed'}
    </span>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <p className="status" role="status">
      {label}
    </p>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="status status-error" role="alert">
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="status status-empty">{children}</p>;
}

export function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {error && (
        <p id={`${id}-error`} className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function Badge({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
