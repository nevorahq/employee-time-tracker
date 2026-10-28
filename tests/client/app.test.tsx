// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TimeTrackerApp } from '../../src/client/TimeTrackerApp.tsx';
import { employee, entry } from '../helpers/dom.tsx';
import { deferred, fail, installFakeFetch, ok, type FakeHandler } from '../helpers/fake-fetch.ts';

const ADA = employee('11111111-1111-4111-8111-111111111111', 'Ada Example');
const BOB = employee('22222222-2222-4222-8222-222222222222', 'Bob Sample');

const section = (name: string) => within(screen.getByRole('region', { name }));
const MIN = 60_000;

afterEach(() => {
  vi.restoreAllMocks();
});

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
    expect(await section('Timesheet').findByText('In progress')).toBeTruthy();
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

describe('Timesheet section', () => {
  it('shows an empty state and the current filters (FR-HIS-3, FR-HIS-7)', async () => {
    installFakeFetch();
    render(<TimeTrackerApp />);
    expect(await section('Timesheet').findByText('No time entries yet.')).toBeTruthy();
    expect(screen.getByTestId('history-filters').textContent).toMatch(/All employees · All dates/);
  });

  it('converts the chosen calendar dates to local-midnight instants, end date inclusive', async () => {
    const net = installFakeFetch();
    render(<TimeTrackerApp />);
    await section('Timesheet').findByText('No time entries yet.');

    fireEvent.change(section('Timesheet').getByLabelText('From date'), { target: { value: '2026-10-24' } });
    fireEvent.change(section('Timesheet').getByLabelText('To date (inclusive)'), { target: { value: '2026-10-25' } });

    await waitFor(() => {
      const last = net.requests('GET', '/api/time-entries').at(-1)!;
      expect(last.query.get('from')).toBe('2026-10-23T21:00:00.000Z');
      expect(last.query.get('to')).toBe('2026-10-25T22:00:00.000Z');
    });
    expect(await section('Timesheet').findByText('No entries match these filters.')).toBeTruthy();
    expect(screen.getByTestId('history-filters').textContent).toContain('2026-10-24 – 2026-10-25');
  });

  it('filters by employee and shows who is selected', async () => {
    const net = installFakeFetch((req) => {
      if (req.method === 'GET' && req.path === '/api/employees') return ok([ADA, BOB]);
    });
    render(<TimeTrackerApp />);
    await waitFor(() => expect(section('Timesheet').getAllByRole('option').length).toBeGreaterThan(1));

    fireEvent.change(section('Timesheet').getByLabelText('Employee'), { target: { value: BOB.id } });
    await waitFor(() => expect(net.requests('GET', '/api/time-entries').at(-1)!.query.get('employeeId')).toBe(BOB.id));
    expect(screen.getByTestId('history-filters').textContent).toContain('Bob Sample');
  });

  it('does not query the server for a reversed date range and explains the problem', async () => {
    const net = installFakeFetch();
    render(<TimeTrackerApp />);
    await section('Timesheet').findByText('No time entries yet.');
    const before = net.requests('GET', '/api/time-entries').length;

    fireEvent.change(section('Timesheet').getByLabelText('From date'), { target: { value: '2026-10-25' } });
    fireEvent.change(section('Timesheet').getByLabelText('To date (inclusive)'), { target: { value: '2026-10-24' } });

    expect(await section('Timesheet').findByText('The start date must not be after the end date.')).toBeTruthy();
    expect(net.requests('GET', '/api/time-entries').length).toBe(before + 1); // only the one for the first date
  });

  const twoDays = () =>
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

  it('lists entries with an In progress badge for a running one and a duration for a finished one', async () => {
    twoDays();
    render(<TimeTrackerApp />);
    const history = section('Timesheet');
    const rows = await history.findAllByRole('row');
    expect(rows).toHaveLength(5); // header + (day bar + entry) x 2
    expect(within(rows[2]!).getByText('In progress')).toBeTruthy();
    expect(within(rows[4]!).getByText('Completed')).toBeTruthy();
    expect(within(rows[4]!).getByText('1:30:00')).toBeTruthy();
    expect(within(rows[4]!).getByText('11:00 – 12:30')).toBeTruthy();
    expect(history.getByText('1–2 of 2')).toBeTruthy();
  });

  it('groups by date with a count and a total per day, and collapses a day on request', async () => {
    twoDays();
    render(<TimeTrackerApp />);
    const history = section('Timesheet');
    await history.findByText('Finished task');

    expect(history.getAllByText('1 item')).toHaveLength(2);
    expect(history.getByText(/Total for .*27 Oct 2026/).parentElement!.textContent).toContain('1:30:00');

    const collapse = history.getByRole('button', { name: /Collapse .*27 Oct 2026/ });
    expect(collapse.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(collapse);
    expect(history.queryByText('Finished task')).toBeNull();
    expect(history.getByRole('button', { name: /Expand .*27 Oct 2026/ }).getAttribute('aria-expanded')).toBe('false');
    expect(history.getByText('Running task')).toBeTruthy();
  });

  it('can group by employee or not at all, and shows the date next to the time when days are not the group', async () => {
    twoDays();
    render(<TimeTrackerApp />);
    const history = section('Timesheet');
    await history.findByText('Finished task');

    fireEvent.click(history.getByRole('button', { name: 'Employee' }));
    expect(history.getByText('2 items')).toBeTruthy();
    expect(history.getByText('27 Oct')).toBeTruthy();
    expect(history.getAllByRole('row')).toHaveLength(4); // header + one employee bar + 2

    fireEvent.click(history.getByRole('button', { name: 'None' }));
    expect(history.getAllByRole('row')).toHaveLength(3); // header + 2
    expect(history.queryByText('2 items')).toBeNull();
  });

  it('switches between the list and the grid without losing the entries', async () => {
    twoDays();
    render(<TimeTrackerApp />);
    const history = section('Timesheet');
    await history.findByText('Finished task');

    fireEvent.click(history.getByRole('button', { name: 'Grid' }));
    expect(history.queryByRole('table')).toBeNull();
    expect(history.getAllByRole('listitem')).toHaveLength(2);
    expect(history.getByRole('button', { name: 'Grid' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(history.getByRole('button', { name: 'List' }));
    expect(history.getByRole('table')).toBeTruthy();
  });

  it('shows the active filters as chips and "Clear Filter" resets them', async () => {
    const net = installFakeFetch((req) => {
      if (req.method === 'GET' && req.path === '/api/employees') return ok([ADA, BOB]);
    });
    render(<TimeTrackerApp />);
    const history = section('Timesheet');
    await waitFor(() => expect(history.getAllByRole('option').length).toBeGreaterThan(1));
    expect(history.queryByText('Filters:')).toBeNull();

    fireEvent.change(history.getByLabelText('Employee'), { target: { value: BOB.id } });
    fireEvent.change(history.getByLabelText('From date'), { target: { value: '2026-10-24' } });
    expect(await history.findByText('Filters:')).toBeTruthy();
    expect(history.getByText('2026-10-24 – …')).toBeTruthy();

    fireEvent.click(history.getByRole('button', { name: 'Remove employee filter' }));
    expect((history.getByLabelText('Employee') as HTMLSelectElement).value).toBe('');
    expect(history.queryByRole('button', { name: 'Remove employee filter' })).toBeNull();

    fireEvent.click(history.getByRole('button', { name: 'Clear Filter' }));
    expect((history.getByLabelText('From date') as HTMLInputElement).value).toBe('');
    expect(history.queryByText('Filters:')).toBeNull();
    await waitFor(() => expect(net.requests('GET', '/api/time-entries').at(-1)!.query.get('employeeId')).toBeNull());
  });

  it('exports the entries as a CSV file', async () => {
    twoDays();
    const created: Blob[] = [];
    // revokeObjectURL stays defined: the download helper calls it from a timer after the test ends.
    Object.assign(URL, { createObjectURL: (blob: Blob) => (created.push(blob), 'blob:test'), revokeObjectURL: () => {} });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<TimeTrackerApp />);
    const history = section('Timesheet');
    await history.findByText('Finished task');

    fireEvent.click(history.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(created).toHaveLength(1));

    expect(click).toHaveBeenCalledOnce();
    const text = await created[0]!.text();
    expect(text).toContain('Employee,Task,Start,End,Duration');
    expect(text).toContain('Ada Example,Finished task,2026-10-27T09:00:00.000Z,2026-10-27T10:30:00.000Z,1:30:00');
  });

  it('exports every matching entry, page by page, not only the 25 on screen', async () => {
    const all = Array.from({ length: 1200 }, (_, i) => entry({ id: `e${i}`, description: `Task ${i}`, endedAt: '2026-10-27T10:00:00.000Z', startedAt: '2026-10-27T09:00:00.000Z' }));
    const net = installFakeFetch((req) => {
      if (req.method === 'GET' && req.path === '/api/employees') return ok([ADA]);
      if (req.path === '/api/time-entries') {
        const offset = Number(req.query.get('offset') ?? 0);
        return ok({ entries: all.slice(offset, offset + Number(req.query.get('limit'))), total: all.length });
      }
    });
    const created: Blob[] = [];
    Object.assign(URL, { createObjectURL: (blob: Blob) => (created.push(blob), 'blob:test'), revokeObjectURL: () => {} });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<TimeTrackerApp />);
    const history = section('Timesheet');
    await history.findByText('Task 0');
    expect(history.getAllByText('on this page').length).toBeGreaterThan(0);

    fireEvent.click(history.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(created).toHaveLength(1));

    const batches = net.requests('GET', '/api/time-entries').filter((r) => r.query.get('limit') === '500');
    expect(batches.map((r) => r.query.get('offset'))).toEqual(['0', '500', '1000']);
    const lines = (await created[0]!.text()).trimEnd().split('\r\n');
    expect(lines).toHaveLength(1201); // header + 1200
    expect(new Set(lines).size).toBe(1201);
  });

  it('reports a failed export and lets the user try again', async () => {
    installFakeFetch((req) => {
      if (req.method === 'GET' && req.path === '/api/employees') return ok([ADA]);
      if (req.path === '/api/time-entries') {
        if (req.query.get('limit') === '500') return fail(500, 'INTERNAL_ERROR', 'Internal server error.');
        return ok({ entries: [entry({ id: 'x', endedAt: '2026-10-27T10:00:00.000Z', startedAt: '2026-10-27T09:00:00.000Z' })], total: 1 });
      }
    });
    render(<TimeTrackerApp />);
    const history = section('Timesheet');
    await history.findByText('Write report');

    fireEvent.click(history.getByRole('button', { name: 'Export' }));

    expect((await history.findByRole('alert')).textContent).toBe('Export failed: Internal server error.');
    expect((history.getByRole('button', { name: 'Export' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('marks group totals "on this page" only when the result does not fit on one page', async () => {
    twoDays();
    const { unmount } = render(<TimeTrackerApp />);
    await section('Timesheet').findByText('Finished task');
    expect(section('Timesheet').queryByText('on this page')).toBeNull();
    unmount();

    installFakeFetch((req) => {
      if (req.method === 'GET' && req.path === '/api/employees') return ok([ADA]);
      if (req.path === '/api/time-entries') return ok({ entries: [entry({ id: 'a', endedAt: '2026-10-27T10:00:00.000Z', startedAt: '2026-10-27T09:00:00.000Z' })], total: 30 });
    });
    render(<TimeTrackerApp />);
    expect(await section('Timesheet').findByText('on this page')).toBeTruthy();
  });

  it('closes the Group By menu on Escape and gives focus back to its button', async () => {
    twoDays();
    render(<TimeTrackerApp />);
    const history = section('Timesheet');
    await history.findByText('Finished task');
    const summary = history.getByText(/Group By Date/).closest('summary')!;
    const details = summary.parentElement as HTMLDetailsElement;

    fireEvent.click(summary);
    await waitFor(() => expect(details.open).toBe(true));
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(details.open).toBe(false));
    expect(document.activeElement).toBe(summary);

    fireEvent.click(summary);
    await waitFor(() => expect(details.open).toBe(true));
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(details.open).toBe(false));
  });

  it('says so when a date cannot be converted instead of silently dropping the bound', async () => {
    const net = installFakeFetch();
    render(<TimeTrackerApp />);
    const history = section('Timesheet');
    await history.findByText('No time entries yet.');
    const before = net.requests('GET', '/api/time-entries').length;

    fireEvent.change(history.getByLabelText('From date'), { target: { value: '0050-01-01' } });

    expect(await history.findByText('Enter valid dates.')).toBeTruthy();
    expect(net.requests('GET', '/api/time-entries').length).toBe(before);
  });

  it('never lets a running entry with a future start (browser clock behind the server) lower a total', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-10-28T11:30:00Z'));
    installFakeFetch((req) => {
      if (req.method === 'GET' && req.path === '/api/employees') return ok([ADA]);
      if (req.path === '/api/time-entries') {
        return ok({
          entries: [
            entry({ id: 'future', description: 'Ahead of the clock', startedAt: '2026-10-28T12:30:00.000Z' }),
            entry({ id: 'done', description: 'One hour', startedAt: '2026-10-28T08:00:00.000Z', endedAt: '2026-10-28T09:00:00.000Z' }),
          ],
          total: 2,
        });
      }
    });
    render(<TimeTrackerApp />);
    const history = section('Timesheet');
    const total = (await history.findByText(/Total for .*28 Oct 2026/)).parentElement!.textContent!;
    expect(total).toContain('1:00:00');
    expect(total).not.toContain('-');
    expect(total).not.toContain('NaN');
  });

  it('is disabled for export while there is nothing to export', async () => {
    installFakeFetch();
    render(<TimeTrackerApp />);
    await section('Timesheet').findByText('No time entries yet.');
    expect((section('Timesheet').getByRole('button', { name: 'Export' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Navigation', () => {
  afterEach(() => {
    window.location.hash = '';
  });

  const nav = () => within(screen.getByRole('navigation', { name: 'Sections' }));
  const go = async (hash: string) => {
    await act(async () => {
      window.location.hash = hash;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  it('starts on the timesheet and follows the URL hash', async () => {
    window.location.hash = '';
    installFakeFetch();
    render(<TimeTrackerApp />);
    expect(nav().getByRole('link', { name: 'Timesheet' }).getAttribute('aria-current')).toBe('page');

    await go('#employees');
    expect(nav().getByRole('link', { name: 'Employees' }).getAttribute('aria-current')).toBe('page');
    expect(nav().getByRole('link', { name: 'Timesheet' }).getAttribute('aria-current')).toBeNull();

    await go('#nonsense');
    expect(nav().getByRole('link', { name: 'Timesheet' }).getAttribute('aria-current')).toBe('page');
  });

  it('shows how many timers are running next to "Active Timer"', async () => {
    installFakeFetch((req) => {
      if (req.path === '/api/timer/active') {
        return ok({ timers: [entry(), entry({ id: 't2', employeeId: 'e2' })], serverTime: new Date().toISOString() });
      }
    });
    render(<TimeTrackerApp />);
    expect(await nav().findByRole('link', { name: /^Active Timer\s*2\s*running$/ })).toBeTruthy();
  });

  it('"Start Timer" opens the timer page and puts the cursor in the form', async () => {
    window.location.hash = '';
    installFakeFetch((req) => {
      if (req.method === 'GET' && req.path === '/api/employees') return ok([ADA]);
    });
    render(<TimeTrackerApp />);
    fireEvent.click(await section('Timesheet').findByRole('button', { name: 'Start Timer' }));

    await waitFor(() => expect(document.activeElement?.id).toBe('timer-employee'));
    expect(nav().getByRole('link', { name: 'Active Timer' }).getAttribute('aria-current')).toBe('page');
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
