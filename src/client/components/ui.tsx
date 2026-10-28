import type { ReactNode } from 'react';

export const messageOf = (err: unknown): string =>
  err instanceof Error && err.message ? err.message : 'Something went wrong. Please try again.';

export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="card" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{title}</h2>
      {children}
    </section>
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
