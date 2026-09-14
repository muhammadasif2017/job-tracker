import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CompanyApplicationStatsStrip } from './company-application-stats';

describe('CompanyApplicationStatsStrip', () => {
  it('shows an empty state when nothing was applied for', () => {
    render(
      <CompanyApplicationStatsStrip
        stats={{
          applied: 0,
          replied: 0,
          ghosted: 0,
          replyRate: 0,
          lastAppliedAt: null,
        }}
      />,
    );

    expect(screen.getByText('No applications yet.')).toBeInTheDocument();
    expect(screen.queryByText('Reply rate')).not.toBeInTheDocument();
  });

  it('shows each figure and the last applied civil date', () => {
    render(
      <CompanyApplicationStatsStrip
        stats={{
          applied: 6,
          replied: 2,
          ghosted: 4,
          replyRate: 33.3,
          lastAppliedAt: '2026-09-12T00:00:00.000Z',
        }}
      />,
    );

    const value = (label: string) =>
      screen.getByText(label).nextElementSibling?.textContent;
    expect(value('Applied')).toBe('6');
    expect(value('Replied')).toBe('2');
    expect(value('Ghosted')).toBe('4');
    expect(value('Reply rate')).toBe('33.3%');
    expect(value('Last applied')).toBe('Sep 12, 2026');
  });
});
