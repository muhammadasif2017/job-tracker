import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChartCard } from './chart-card';

describe('ChartCard', () => {
  it('shows a skeleton while loading', () => {
    const { container } = render(
      <ChartCard title="Trend" loading error={false} errorMessage="">
        <div>content</div>
      </ChartCard>,
    );
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    expect(screen.queryByText('content')).not.toBeInTheDocument();
  });

  it('shows the error message when error is true', () => {
    render(
      <ChartCard title="Trend" loading={false} error errorMessage="Failed to load">
        <div>content</div>
      </ChartCard>,
    );
    expect(screen.getByText('Failed to load')).toBeInTheDocument();
    expect(screen.queryByText('content')).not.toBeInTheDocument();
  });

  it('renders children when not loading and not errored', () => {
    render(
      <ChartCard title="Trend" loading={false} error={false} errorMessage="">
        <div>content</div>
      </ChartCard>,
    );
    expect(screen.getByText('Trend')).toBeInTheDocument();
    expect(screen.getByText('content')).toBeInTheDocument();
  });
});
