import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TrendChart } from './trend-chart';
import type { TrendStats } from '../../types';

describe('TrendChart', () => {
  it('shows "No data yet" when there are no buckets', () => {
    render(<TrendChart data={{ granularity: 'month', buckets: [] }} />);
    expect(screen.getByText('No data yet')).toBeInTheDocument();
  });

  it('renders a chart when buckets are present', () => {
    const data: TrendStats = {
      granularity: 'week',
      buckets: [
        { label: 'Jul 6', periodStart: '2026-07-06', count: 2, cumulative: 2 },
        { label: 'Jul 13', periodStart: '2026-07-13', count: 1, cumulative: 3 },
      ],
    };
    const { container } = render(<TrendChart data={data} />);
    expect(screen.queryByText('No data yet')).not.toBeInTheDocument();
    expect(
      container.querySelector('.recharts-responsive-container'),
    ).toBeInTheDocument();
  });
});
