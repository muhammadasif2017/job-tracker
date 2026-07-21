import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FunnelChart } from './funnel-chart';
import type { FunnelStats } from '../../types';

function makeData(overrides: Partial<FunnelStats> = {}): FunnelStats {
  return {
    funnel: [
      { status: 'WISHLIST', reached: 0 },
      { status: 'APPLIED', reached: 0 },
      { status: 'INTERVIEWING', reached: 0 },
      { status: 'OFFER', reached: 0 },
    ],
    dropoff: [
      { status: 'REJECTED', count: 0 },
      { status: 'GHOSTED', count: 0 },
    ],
    avgTimeInStageDays: {},
    responseRateBySource: [],
    ...overrides,
  };
}

describe('FunnelChart', () => {
  it('shows "No data yet" when every stage has zero reached', () => {
    render(<FunnelChart data={makeData()} />);
    expect(screen.getByText('No data yet')).toBeInTheDocument();
  });

  it('renders dropoff counts when data is present', () => {
    render(
      <FunnelChart
        data={makeData({
          funnel: [
            { status: 'WISHLIST', reached: 2 },
            { status: 'APPLIED', reached: 5 },
            { status: 'INTERVIEWING', reached: 2 },
            { status: 'OFFER', reached: 1 },
          ],
          dropoff: [
            { status: 'REJECTED', count: 3 },
            { status: 'GHOSTED', count: 1 },
          ],
        })}
      />,
    );
    expect(screen.getByText(/Rejected: 3/)).toBeInTheDocument();
    expect(screen.getByText(/Ghosted: 1/)).toBeInTheDocument();
  });

  it('renders "—" for avg time in stage and response rate when empty', () => {
    render(
      <FunnelChart
        data={makeData({ funnel: [{ status: 'APPLIED', reached: 1 }] })}
      />,
    );
    expect(screen.getAllByText('—')).toHaveLength(2);
  });

  it('renders avg time in stage and response rate by source when present', () => {
    render(
      <FunnelChart
        data={makeData({
          funnel: [{ status: 'APPLIED', reached: 1 }],
          avgTimeInStageDays: { APPLIED: 2.7 },
          responseRateBySource: [
            { source: 'LINKEDIN', total: 2, responseRate: 100 },
            { source: 'UNSPECIFIED', total: 1, responseRate: 0 },
          ],
        })}
      />,
    );
    expect(screen.getByText(/Applied: 2.7d/)).toBeInTheDocument();
    expect(screen.getByText(/LinkedIn: 100%/)).toBeInTheDocument();
    expect(screen.getByText(/Unspecified: 0%/)).toBeInTheDocument();
  });
});
