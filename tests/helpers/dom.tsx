import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

export const employee = (id: string, name: string, createdAt = '2026-10-28T08:00:00.000Z') => ({ id, name, createdAt });

export const entry = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 't1',
  employeeId: 'e1',
  employeeName: 'Ada Example',
  description: 'Write report',
  startedAt: '2026-10-28T10:00:00.000Z',
  endedAt: null,
  ...over,
});
