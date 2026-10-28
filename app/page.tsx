import { TimeTrackerApp } from '@/client/TimeTrackerApp';

/** Server-rendered shell without data: all interactivity lives in Client Components. */
export default function Page() {
  return (
    <main className="container">
      <header className="header">
        <h1>Employee Time Tracker</h1>
        <p className="muted">Start and stop timers, review history, and see totals per employee.</p>
      </header>
      <TimeTrackerApp />
    </main>
  );
}
