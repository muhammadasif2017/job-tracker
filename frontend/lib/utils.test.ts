import { describe, it, expect } from 'vitest';
import {
  cn,
  formatCivilDate,
  formatDate,
  formatRelative,
  toDateInputValue,
  todayInputValue,
} from './utils';

describe('cn', () => {
  it('merges class names, keeping the later conflicting Tailwind class', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4');
  });

  it('drops falsy values', () => {
    expect(cn('a', false, undefined, null, 'b')).toBe('a b');
  });
});

describe('formatDate', () => {
  it('formats an ISO datetime string', () => {
    expect(formatDate('2026-06-09T15:30:00.000Z')).toBe('Jun 9, 2026');
  });

  it('formats a Date instance', () => {
    expect(formatDate(new Date(2026, 0, 15))).toBe('Jan 15, 2026');
  });
});

describe('formatCivilDate', () => {
  it('reads the UTC calendar date, not the local one', () => {
    // UTC midnight on Jan 1 — a naive local read west of UTC would show Dec 31.
    expect(formatCivilDate('2026-01-01T00:00:00.000Z')).toBe('Jan 1, 2026');
  });

  it('is stable at the last instant of a UTC day', () => {
    expect(formatCivilDate('2026-06-30T23:59:59.999Z')).toBe('Jun 30, 2026');
  });
});

describe('toDateInputValue', () => {
  it('round-trips a civil date back to the value the date input holds', () => {
    expect(toDateInputValue('2026-01-01T00:00:00.000Z')).toBe('2026-01-01');
  });
});

describe('todayInputValue', () => {
  it("uses the viewer's calendar, not UTC's", () => {
    // 02:00 on Jan 2 local is still Jan 1 in UTC. Prefilling a form from
    // toISOString() here would date a new application a day early.
    const localEarlyMorning = new Date(2026, 0, 2, 2, 0, 0);
    expect(todayInputValue(localEarlyMorning)).toBe('2026-01-02');
  });
});

describe('formatRelative', () => {
  it('describes a past date relative to now', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    expect(formatRelative(twoDaysAgo)).toBe('2 days ago');
  });
});
