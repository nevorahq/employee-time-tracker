// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TimeTrackerApp } from '../../src/client/TimeTrackerApp.tsx';
import { employee, entry } from '../helpers/dom.tsx';
import { deferred, fail, installFakeFetch, ok, type FakeHandler } from '../helpers/fake-fetch.ts';

const ADA = employee('11111111-1111-4111-8111-111111111111', 'Ada Example');
const BOB = employee('22222222-2222-4222-8222-222222222222', 'Bob Sample');

const section = (name: string) => within(screen.getByRole('region', { name }));
const MIN = 60_000;

describe('Employees section', () => {
  it('shows an inline error for a blank name and sends nothing', async () => {
    const net = installFakeFetch();
    render(<TimeTrackerApp />);
    await screen.findByText('No employees yet. Add the first one above.');

    fireEvent.change(section('Employees').getByLabelText('Name'), { target: { value: '   ' } });
    fireEvent.click(section('Employees').getByRole('button', { name: 'Add employee' }));

    expect(await section('Employees').findByText('Name is required.')).toBeTruthy();
    expect(net.requests('POST', '/api/employees')).toHaveLength(0);
  });

  it('rejects a name longer than 100 characters with the same rule as the server', async () => {
    const net = installFakeFetch();
    render(<TimeTrackerApp />);
    await screen.findByText('No employees yet. Add the first one above.');

    fireEvent.change(section('Employees').getByLabelText('Name'), { target: { value: 'x'.repeat(101) } });
    fireEvent.click(section('Employees').getByRole('button', { name: 'Add employee' }));

    expect(await section('Employees').findByText(/at most 100 characters/)).toBeTruthy();
    expect(net.requests('POST', '/api/employees')).toHaveLength(0);
  });

  it('disables the button while the request is in flight and never sends a duplicate', async () => {
    const reply = deferred<ReturnType<typeof ok>>();
    const created: unknown[] = [];
    const net = installFakeFetch((req) => {
      if (req.method === 'POST' && req.path === '/api/employees') return reply.promise;
      if (req.method === 'GET' && req.path === '/api/employees') return ok(created);
    });
    render(<TimeTrackerApp />);
    await screen.findByText('No employees yet. Add the first one above.');

    const input = section('Employees').getByLabelText('Name');
    fireEvent.change(input, { target: { value: '  Ada Example ' } });
    const button = section('Employees').getByRole('button', { name: 'Add employee' });
    fireEvent.click(button);

    const pending = await section('Employees').findByRole('button', { name: 'Adding…' });
    expect((pending as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(pending);
    fireEvent.submit(input.closest('form')!);
    expect(net.requests('POST', '/api/employees')).toHaveLength(1);
    expect(net.requests('POST', '/api/employees')[0]?.body).toEqual({ name: 'Ada Example' });

    created.push(ADA);
    await act(async () => reply.resolve(ok(ADA, 201)));

    expect(await screen.findByText('Employee "Ada Example" was added.')).toBeTruthy();
    expect((await section('Employees').findByRole('button', { name: 'Add employee' }) as HTMLButtonElement).disabled).toBe(false);
    expect((input as HTMLInputElement).value).toBe('');
    expect(await section('Employees').findByRole('cell', { name: 'Ada Example' })).toBeTruthy();
  });

  it('shows a server error next to the field', async () => {
    installFakeFetch((req) => {
      if (req.method === 'POST') return fail(400, 'VALIDATION_ERROR', 'Name is required.');
    });
    render(<TimeTrackerApp />);
    await screen.findByText('No employees yet. Add the first one above.');
    fireEvent.change(section('Employees').getByLabelText('Name'), { target: { value: 'Ada' } });
    fireEvent.click(section('Employees').getByRole('button', { name: 'Add employee' }));
    expect(await section('Employees').findByRole('alert')).toBeTruthy();
  });

  it('adds a short id suffix when two employees share a name (FR-EMP-5)', async () => {
    const twin1 = employee('a1b2c3d4-0000-4000-8000-000000000001', 'Alice Smith');
    const twin2 = employee('e5f6a7b8-0000-4000-8000-000000000002', 'Alice Smith');
    installFakeFetch((req) => {
      if (req.method === 'GET' && req.path === '/api/employees') return ok([twin1, twin2, BOB]);
    });
    render(<TimeTrackerApp />);

    expect(await section('Employees').findByRole('cell', { name: 'Alice Smith · #a1b2' })).toBeTruthy();
    expect(section('Employees').getByRole('cell', { name: 'Alice Smith · #e5f6' })).toBeTruthy();
    expect(section('Employees').getByRole('cell', { name: 'Bob Sample' })).toBeTruthy();
    const options = within(screen.getByLabelText('Employee', { selector: '#timer-employee' })).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toContain('Alice Smith · #a1b2');
  });

  it('shows an error state with a retry when the list cannot be loaded', async () => {
    let failing = true;
    installFakeFetch((req) => {
      if (req.method === 'GET' && req.path === '/api/employees') return failing ? fail(500, 'INTERNAL_ERROR', 'Internal server error.') : ok([ADA]);
    });
    render(<TimeTrackerApp />);
    const alert = await section('Employees').findByRole('alert');
    expect(alert.textContent).toContain('Internal server error.');

    failing = false;
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await section('Employees').findByRole('cell', { name: 'Ada Example' })).toBeTruthy();
  });
});

describe('Active Timer section', () => {
  const server = (over: { timers?: unknown[]; serverTime?: string; start?: FakeHandler } = {}): FakeHandler => (req) => {
    if (req.method === 'GET' && req.path === '/api/employees') return ok([ADA, BOB]);
    if (req.path === '/api/timer/active') {
      return ok({ timers: over.timers ?? [], serverTime: over.serverTime ?? new Date().toISOString() });
    }
    if (req.method === 'POST' && req.path === '/api/timer/start' && over.start) return over.start(req);
  };

  it('restores a running timer on page load with the correct elapsed time and keeps it ticking (FR-REC-6)', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-10-28T11:30:00Z'));
    installFakeFetch(
      server({
        timers: [entry({ startedAt: '2026-10-28T10:00:00.000Z' })],
        serverTime: '2026-10-28T11:30:00.000Z',
      }),
    );
    render(<TimeTrackerApp />);

    const elapsed = await section('Active Timer').findByLabelText('Elapsed time for Ada Example');
    expect(elapsed.textContent).toBe('1:30:00');
    expect(section('Active Timer').getByText('Write report')).toBeTruthy();

    await act(async () => void vi.advanceTimersByTime(3000));
    expect(elapsed.textContent).toBe('1:30:03');
  });

  it('corrects for a browser clock that differs from the server clock (FR-REC-7)', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-10-28T11:25:00Z')); // browser is 5 minutes behind
    installFakeFetch(
      server({ timers: [entry({ startedAt: '2026-10-28T10:00:00.000Z' })], serverTime: '2026-10-28T11:30:00.000Z' }),
    );
    render(<TimeTrackerApp />);
    expect((await section('Active Timer').findByLabelText('Elapsed time for Ada Example')).textContent).toBe('1:30:00');
  });

  it('warns about a timer that has been running for more than 12 hours (FR-TMR-12)', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-10-29T09:00:00Z'));
    installFakeFetch(
      server({ timers: [entry({ startedAt: '2026-10-28T10:00:00.000Z' })], serverTime: '2026-10-29T09:00:00.000Z' }),
    );
    render(<TimeTrackerApp />);
    expect(await section('Active Timer').findByText(/over 12 hours/)).toBeTruthy();
  });

  it('shows an empty state when nothing is running', async () => {
    installFakeFetch(server());
    render(<TimeTrackerApp />);
    expect(await section('Active Timer').findByText('No timers are running.')).toBeTruthy();
  });

  it('validates the employee and the description before sending anything', async () => {
    const net = installFakeFetch(server());
    render(<TimeTrackerApp />);
    await screen.findByText('No timers are running.');
    await waitFor(() => expect(section('Active Timer').getAllByRole('option').length).toBeGreaterThan(1));

    fireEvent.click(section('Active Timer').getByRole('button', { name: 'Start' }));
    expect(await section('Active Timer').findByText('Select an employee.')).toBeTruthy();
    expect(section('Active Timer').getByText('Task description is required.')).toBeTruthy();

    fireEvent.change(section('Active Timer').getByLabelText('Employee'), { target: { value: ADA.id } });
    fireEvent.change(section('Active Timer').getByLabelText('Task description'), { target: { value: '   ' } });
    fireEvent.click(section('Active Timer').getByRole('button', { name: 'Start' }));
    expect(await section('Active Timer').findByText('Task description is required.')).toBeTruthy();
    expect(net.requests('POST', '/api/timer/start')).toHaveLength(0);
  });

  it('starts a timer with the trimmed description and re-reads timers and history afterwards (UI-8)', async () => {
    let started = false;
    const net = installFakeFetch((req) => {
      if (req.method === 'GET' && req.path === '/api/employees') return ok([ADA, BOB]);
      if (req.method === 'POST' && req.path === '/api/timer/start') {
        started = true;
        return ok(entry(), 201);
      }
      if (req.path === '/api/timer/active') {
        return ok({ timers: started ? [entry()] : [], serverTime: new Date().toISOString() });
      }
      if (req.path === '/api/time-entries') return ok({ entries: started ? [entry()] : [], total: started ? 1 : 0 });
    });
    render(<TimeTrackerApp />);
    await screen.findByText('No timers are running.');
    await waitFor(() => expect(section('Active Timer').getAllByRole('option').length).toBeGreaterThan(1));

    fireEvent.change(section('Active Timer').getByLabelText('Employee'), { target: { value: ADA.id } });
    fireEvent.change(section('Active Timer').getByLabelText('Task description'), { target: { value: '  Write report  ' } });
    fireEvent.click(section('Active Timer').getByRole('button', { name: 'Start' }));

    expect(await section('Active Timer').findByLabelText('Elapsed time for Ada Example')).toBeTruthy();
    expect(net.requests('POST', '/api/timer/start')[0]?.body).toEqual({ employeeId: ADA.id, description: 'Write report' });
    expect(await section('Time Entry History').findByText('In progress')).toBeTruthy();
    expect(screen.getByText('Timer started for Ada Example.')).toBeTruthy();
  });

  it('warns and disables Start when the selected employee already has an active timer (UI-5)', async () => {
    installFakeFetch(server({ timers: [entry({ employeeId: ADA.id })] }));
    render(<TimeTrackerApp />);
    await section('Active Timer').findByLabelText('Elapsed time for Ada Example');
    await waitFor(() => expect(section('Active Timer').getAllByRole('option').length).toBeGreaterThan(1));

    fireEvent.change(section('Active Timer').getByLabelText('Employee'), { target: { value: ADA.id } });

    expect(await section('Active Timer').findByText(/already has an active timer/)).toBeTruthy();
    expect((section('Active Timer').getByRole('button', { name: 'Start' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(section('Active Timer').getByLabelText('Employee'), { target: { value: BOB.id } });
    expect((section('Active Timer').getByRole('button', { name: 'Start' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows the server conflict if someone else started a timer in the meantime', async () => {
    installFakeFetch(
      server({ start: () => fail(409, 'TIMER_ALREADY_RUNNING', 'This employee already has an active timer.') }),
    );
    render(<TimeTrackerApp />);
    await screen.findByText('No timers are running.');
    await waitFor(() => expect(section('Active Timer').getAllByRole('option').length).toBeGreaterThan(1));

    fireEvent.change(section('Active Timer').getByLabelText('Employee'), { target: { value: ADA.id } });
    fireEvent.change(section('Active Timer').getByLabelText('Task description'), { target: { value: 'Work' } });
    fireEvent.click(section('Active Timer').getByRole('button', { name: 'Start' }));

    const alert = await section('Active Timer').findByRole('alert');
    expect(alert.textContent).toBe('This employee already has an active timer.');
  });

  it('disables Start while the request is in flight', async () => {
    const reply = deferred<ReturnType<typeof ok>>();
    const net = installFakeFetch(server({ start: () => reply.promise as never }));
    render(<TimeTrackerApp />);
    await screen.findByText('No timers are running.');
    await waitFor(() => expect(section('Active Timer').getAllByRole('option').length).toBeGreaterThan(1));
    fireEvent.change(section('Active Timer').getByLabelText('Employee'), { target: { value: BOB.id } });
    fireEvent.change(section('Active Timer').getByLabelText('Task description'), { target: { value: 'Work' } });
    fireEvent.click(section('Active Timer').getByRole('button', { name: 'Start' }));

    const pending = (await section('Active Timer').findByRole('button', { name: 'Starting…' })) as HTMLButtonElement;
    expect(pending.disabled).toBe(true);
    fireEvent.click(pending);
    expect(net.requests('POST', '/api/timer/start')).toHaveLength(1);
    await act(async () => reply.resolve(ok(entry(), 201)));
  });

  it('stops a timer once: the Stop button is disabled while the request is in flight', async () => {
    const reply = deferred<ReturnType<typeof ok>>();
    const net = installFakeFetch((req) => {
      if (req.method === 'GET' && req.path === '/api/employees') return ok([ADA]);
      if (req.path === '/api/timer/active') return ok({ timers: [entry()], serverTime: new Date().toISOString() });
      if (req.method === 'POST' && req.path === '/api/timer/t1/stop') return reply.promise;
    });
    render(<TimeTrackerApp />);
    const stop = await section('Active Timer').findByRole('button', { name: 'Stop timer for Ada Example' });
    fireEvent.click(stop);

    const pending = (await section('Active Timer').findByRole('button', { name: 'Stop timer for Ada Example' })) as HTMLButtonElement;
    await waitFor(() => expect(pending.disabled).toBe(true));
    fireEvent.click(pending);
    expect(net.requests('POST', '/api/timer/t1/stop')).toHaveLength(1);
    await act(async () => reply.resolve(ok(entry({ endedAt: '2026-10-28T10:05:00.000Z' }))));
    expect(await screen.findByText('Timer stopped for Ada Example.')).toBeTruthy();
  });
});

describe('Time Entry History section', () => {
  it('shows an empty state and the current filters (FR-HIS-3, FR-HIS-7)', async () => {
    installFakeFetch();
    render(<TimeTrackerApp />);
    expect(await section('Time Entry History').findByText('No time entries yet.')).toBeTruthy();
    expect(screen.getByTestId('history-filters').textContent).toMatch(/All employees · All dates/);
  });

  it('converts the chosen calendar dates to local-midnight instants, end date inclusive', async () => {
    const net = installFakeFetch();
    render(<TimeTrackerApp />);
    await section('Time Entry History').findByText('No time entries yet.');

    fireEvent.change(section('Time Entry History').getByLabelText('From date'), { target: { value: '2026-10-24' } });
    fireEvent.change(section('Time Entry History').getByLabelText('To date (inclusive)'), { target: { value: '2026-10-25' } });

    await waitFor(() => {
      const last = net.requests('GET', '/api/time-entries').at(-1)!;
      expect(last.query.get('from')).toBe('2026-10-23T21:00:00.000Z');
      expect(last.query.get('to')).toBe('2026-10-25T22:00:00.000Z');
    });
    expect(await section('Time Entry History').findByText('No entries match these filters.')).toBeTruthy();
    expect(screen.getByTestId('history-filters').textContent).toContain('2026-10-24 – 2026-10-25');
  });

  it('filters by employee and shows who is selected', async () => {
    const net = installFakeFetch((req) => {
      if (req.method === 'GET' && req.path === '/api/employees') return ok([ADA, BOB]);
    });
    render(<TimeTrackerApp />);
    await waitFor(() => expect(section('Time Entry History').getAllByRole('option').length).toBeGreaterThan(1));

    fireEvent.change(section('Time Entry History').getByLabelText('Employee'), { target: { value: BOB.id } });
    await waitFor(() => expect(net.requests('GET', '/api/time-entries').at(-1)!.query.get('employeeId')).toBe(BOB.id));
    expect(screen.getByTestId('history-filters').textContent).toContain('Bob Sample');
  });

  it('does not query the server for a reversed date range and explains the problem', async () => {
    const net = installFakeFetch();
    render(<TimeTrackerApp />);
    await section('Time Entry History').findByText('No time entries yet.');
    const before = net.requests('GET', '/api/time-entries').length;

    fireEvent.change(section('Time Entry History').getByLabelText('From date'), { target: { value: '2026-10-25' } });
    fireEvent.change(section('Time Entry History').getByLabelText('To date (inclusive)'), { target: { value: '2026-10-24' } });

    expect(await section('Time Entry History').findByText('The start date must not be after the end date.')).toBeTruthy();
    expect(net.requests('GET', '/api/time-entries').length).toBe(before + 1); // only the one for the first date
  });

  it('lists entries with an In progress badge for a running one and a duration for a finished one', async () => {
    installFakeFetch((req) => {
      if (req.method === 'GET' && req.path === '/api/employees') return ok([ADA]);
      if (req.path === '/api/time-entries') {
        return ok({
          entries: [
            entry({ id: 'run', description: 'Running task' }),
            entry({ id: 'done', description: 'Finished task', startedAt: '2026-10-27T09:00:00.000Z', endedAt: '2026-10-27T10:30:00.000Z' }),
          ],
          total: 2,
        });
      }
    });
    render(<TimeTrackerApp />);
    const history = section('Time Entry History');
    const rows = await history.findAllByRole('row');
    expect(rows).toHaveLength(3); // header + 2
    expect(within(rows[1]!).getByText('In progress')).toBeTruthy();
    expect(within(rows[2]!).getByText('1:30:00')).toBeTruthy();
    expect(history.getByText('1–2 of 2')).toBeTruthy();
  });
});

describe('Reports section', () => {
  const emptyReport = {
    period: { from: '2026-10-23T21:00:00.000Z', to: '2026-10-25T22:00:00.000Z' },
    evaluatedAt: '2026-10-28T09:00:00.000Z',
    totals: { finalizedMs: 0, provisionalMs: 0, totalMs: 0 },
    employees: [],
    entries: [],
  };

  const runReport = (from: string, to: string) => {
    fireEvent.change(section('Reports').getByLabelText('Start date'), { target: { value: from } });
    fireEvent.change(section('Reports').getByLabelText('End date (inclusive)'), { target: { value: to } });
    fireEvent.click(section('Reports').getByRole('button', { name: 'Run report' }));
  };

  it('shows the browser time zone next to the date filter (FR-REP-9)', async () => {
    installFakeFetch();
    render(<TimeTrackerApp />);
    expect(await section('Reports').findByText(/Europe\/Chisinau/)).toBeTruthy();
  });

  it('sends local-midnight instants with an inclusive end date', async () => {
    const net = installFakeFetch((req) => {
      if (req.path === '/api/reports/summary') return ok(emptyReport);
    });
    render(<TimeTrackerApp />);
    runReport('2026-10-24', '2026-10-25');
    await waitFor(() => expect(net.requests('GET', '/api/reports/summary')).toHaveLength(1));
    const q = net.requests('GET', '/api/reports/summary')[0]!.query;
    expect(q.get('from')).toBe('2026-10-23T21:00:00.000Z');
    expect(q.get('to')).toBe('2026-10-25T22:00:00.000Z');
    expect(q.get('employeeId')).toBeNull();
  });

  it('[S25] shows an empty report as a normal result with zero totals, not an error', async () => {
    installFakeFetch((req) => {
      if (req.path === '/api/reports/summary') return ok(emptyReport);
    });
    render(<TimeTrackerApp />);
    runReport('2026-10-24', '2026-10-25');
    expect(await section('Reports').findByText(/No time was recorded in this period/)).toBeTruthy();
    expect(section('Reports').queryByRole('alert')).toBeNull();
  });

  it('rejects an end date before the start date without calling the server', async () => {
    const net = installFakeFetch();
    render(<TimeTrackerApp />);
    runReport('2026-10-25', '2026-10-24');
    expect(await section('Reports').findByText('The start date must not be after the end date.')).toBeTruthy();
    expect(net.requests('GET', '/api/reports/summary')).toHaveLength(0);
  });

  it('rejects ranges longer than 366 days', async () => {
    const net = installFakeFetch();
    render(<TimeTrackerApp />);
    runReport('2024-01-01', '2025-06-01');
    expect(await section('Reports').findByText(/at most 366 days/)).toBeTruthy();
    expect(net.requests('GET', '/api/reports/summary')).toHaveLength(0);
  });

  it('requires both dates', async () => {
    const net = installFakeFetch();
    render(<TimeTrackerApp />);
    runReport('', '2026-10-25');
    expect(await section('Reports').findByText('Choose both a start and an end date.')).toBeTruthy();
    expect(net.requests('GET', '/api/reports/summary')).toHaveLength(0);
  });

  it('shows per-employee and grand totals and marks running timers as provisional', async () => {
    const report = {
      period: emptyReport.period,
      evaluatedAt: '2026-10-28T09:45:00.000Z',
      totals: { finalizedMs: 60 * MIN, provisionalMs: 30 * MIN, totalMs: 90 * MIN },
      employees: [
        { employeeId: ADA.id, name: 'Ada Example', entryCount: 2, finalizedMs: 60 * MIN, provisionalMs: 30 * MIN, totalMs: 90 * MIN },
      ],
      entries: [
        { ...entry({ id: 'a', endedAt: '2026-10-28T08:00:00.000Z', startedAt: '2026-10-28T07:00:00.000Z' }), isActive: false, contributionMs: 60 * MIN },
        { ...entry({ id: 'b' }), isActive: true, contributionMs: 30 * MIN },
      ],
    };
    installFakeFetch((req) => {
      if (req.method === 'GET' && req.path === '/api/employees') return ok([ADA]);
      if (req.path === '/api/reports/summary') return ok(report);
    });
    render(<TimeTrackerApp />);
    runReport('2026-10-24', '2026-10-25');

    expect((await section('Reports').findByTestId('report-total')).textContent).toBe('1:30:00');
    expect(section('Reports').getByText(/up to \d\d:\d\d \(provisional\)/)).toBeTruthy();
    expect(section('Reports').getAllByText('In progress').length).toBeGreaterThan(0);
    expect(section('Reports').getByText(/as of \d\d:\d\d/)).toBeTruthy();
  });

  it('shows the server message when the report fails', async () => {
    installFakeFetch((req) => {
      if (req.path === '/api/reports/summary') return fail(400, 'INVALID_DATE_RANGE', '"from" must be earlier than "to".');
    });
    render(<TimeTrackerApp />);
    runReport('2026-10-24', '2026-10-25');
    const alert = await section('Reports').findByRole('alert');
    expect(alert.textContent).toContain('"from" must be earlier than "to".');
  });

  it('reports a network failure in plain words', async () => {
    installFakeFetch((req) => {
      if (req.path === '/api/reports/summary') throw new TypeError('Failed to fetch');
      return undefined;
    });
    render(<TimeTrackerApp />);
    runReport('2026-10-24', '2026-10-25');
    // fake fetch itself throws, which the api client turns into a NETWORK_ERROR
    expect((await section('Reports').findByRole('alert')).textContent).toMatch(/Cannot reach the server/);
  });
});
