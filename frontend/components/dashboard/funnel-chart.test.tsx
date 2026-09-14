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
    responseRateByDiscoverySource: [],
    replyTiming: {
      repliedCount: 0,
      medianDays: null,
      repliedAfter14DaysPercent: 0,
    },
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
    // main funnel bar + dropoff mini-chart; avg-time and both response-rate
    // breakdowns (channel, discovery source) are empty ("—")
    expect(chartCount(container)).toBe(2);
    expect(screen.getAllByText('—')).toHaveLength(3);
  });

  it('renders "—" for avg time in stage and both response rates when empty', () => {
    render(
      <FunnelChart
        data={makeData({ funnel: [{ status: 'APPLIED', reached: 1 }] })}
      />,
    );
    expect(screen.getAllByText('—')).toHaveLength(3);
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
          responseRateByDiscoverySource: [
            { source: 'ROZEE', total: 2, responseRate: 50 },
          ],
        })}
      />,
    );
    expect(screen.getByText('Avg. time in stage')).toBeInTheDocument();
    expect(
      screen.getByText('Response rate by application channel'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Response rate by discovery source'),
    ).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
    // main funnel bar + dropoff + avg-time + channel + discovery source
    expect(chartCount(container)).toBe(5);
  });

  describe('reply timing', () => {
    const withData = { funnel: [{ status: 'APPLIED' as const, reached: 1 }] };

    it('shows the median reply time and how many replies came after 14 days', () => {
      render(
        <FunnelChart
          data={makeData({
            ...withData,
            replyTiming: {
              repliedCount: 4,
              medianDays: 6.5,
              repliedAfter14DaysPercent: 25,
            },
          })}
        />,
      );
      expect(screen.getByText('Time to reply')).toBeInTheDocument();
      expect(screen.getByText('6.5 days')).toBeInTheDocument();
      expect(screen.getByText('median across 4 replies')).toBeInTheDocument();
      expect(screen.getByText('25% arrived after 14 days')).toBeInTheDocument();
    });

    it('uses the singular for a one-day median and a single reply', () => {
      render(
        <FunnelChart
          data={makeData({
            ...withData,
            replyTiming: {
              repliedCount: 1,
              medianDays: 1,
              repliedAfter14DaysPercent: 0,
            },
          })}
        />,
      );
      expect(screen.getByText('1 day')).toBeInTheDocument();
      expect(screen.getByText('median across 1 reply')).toBeInTheDocument();
    });

    it('says there are no replies yet when nothing has a reply date', () => {
      render(<FunnelChart data={makeData(withData)} />);
      expect(screen.getByText('No replies yet')).toBeInTheDocument();
      expect(screen.queryByText(/median across/)).not.toBeInTheDocument();
    });
  });
});
