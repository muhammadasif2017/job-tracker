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

// jsdom has no ResizeObserver, so recharts' ResponsiveContainer renders at
// 0x0 and never draws bar/label content — these tests assert chart presence
// (one `.recharts-responsive-container` per rendered mini-chart) rather than
// rendered pixel/text content.
function chartCount(container: HTMLElement) {
  return container.querySelectorAll('.recharts-responsive-container').length;
}

describe('FunnelChart', () => {
  it('shows "No data yet" when every stage has zero reached', () => {
    render(<FunnelChart data={makeData()} />);
    expect(screen.getByText('No data yet')).toBeInTheDocument();
  });

  it('renders the funnel bar and a dropoff mini-chart when data is present', () => {
    const { container } = render(
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
    expect(screen.getByText('Dropoff')).toBeInTheDocument();
    // main funnel bar + dropoff mini-chart, avg-time/response-rate empty ("—")
    expect(chartCount(container)).toBe(2);
    expect(screen.getAllByText('—')).toHaveLength(2);
  });

  it('renders "—" for avg time in stage and response rate when empty', () => {
    render(
      <FunnelChart
        data={makeData({ funnel: [{ status: 'APPLIED', reached: 1 }] })}
      />,
    );
    expect(screen.getAllByText('—')).toHaveLength(2);
  });

  it('renders avg-time and response-rate mini-charts when data is present', () => {
    const { container } = render(
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
    expect(screen.getByText('Avg. time in stage')).toBeInTheDocument();
    expect(screen.getByText('Response rate by source')).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
    // main funnel bar + dropoff + avg-time + response-rate = 4 mini-charts
    expect(chartCount(container)).toBe(4);
  });
});
