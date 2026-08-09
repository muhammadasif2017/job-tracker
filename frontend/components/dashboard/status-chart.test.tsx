import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusChart } from './status-chart';
import type { JobStats } from '../../types';

function makeStats(byStatus: Partial<JobStats['byStatus']> = {}): JobStats {
  return {
    total: 0,
    thisMonth: 0,
    responseRate: 0,
    ghostRate: 0,
    byStatus: {
      WISHLIST: 0,
      APPLIED: 0,
      INTERVIEWING: 0,
      OFFER: 0,
      REJECTED: 0,
      GHOSTED: 0,
      ...byStatus,
    },
  };
}

describe('StatusChart', () => {
  it('shows "No data yet" when every status count is zero', () => {
    render(<StatusChart stats={makeStats()} />);
    expect(screen.getByText('No data yet')).toBeInTheDocument();
  });

  it('renders a chart when at least one status has a count', () => {
    const { container } = render(
      <StatusChart stats={makeStats({ APPLIED: 3, OFFER: 1 })} />,
    );
    expect(screen.queryByText('No data yet')).not.toBeInTheDocument();
    expect(
      container.querySelector('.recharts-responsive-container'),
    ).toBeInTheDocument();
  });
});
