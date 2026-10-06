import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  StatusChartPanel,
  FunnelChartPanel,
  TrendChartPanel,
} from './dashboard-charts';
import type { JobStats, TrendStats } from '../../types';

const stats: JobStats = {
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
  },
};

const trend: TrendStats = { granularity: 'week', buckets: [] };

describe('StatusChartPanel', () => {
  it('shows a chart skeleton until the stats arrive', () => {
    render(<StatusChartPanel />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading chart');
  });

  it('renders the status chart once the stats arrive', () => {
    render(<StatusChartPanel stats={stats} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText('No data yet')).toBeInTheDocument();
  });
});

describe('FunnelChartPanel', () => {
  it('shows a skeleton the height of the funnel until the data arrives', () => {
    const { container } = render(<FunnelChartPanel />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading chart');
    expect(container.querySelector('.animate-pulse')).toHaveClass('h-[420px]');
  });
});

describe('TrendChartPanel', () => {
  it('shows a chart skeleton until the data arrives', () => {
    render(<TrendChartPanel />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading chart');
  });

  it('renders the trend chart once the data arrives', () => {
    render(<TrendChartPanel data={trend} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
