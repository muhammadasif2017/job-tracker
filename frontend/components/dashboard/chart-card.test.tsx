import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChartCard, ChartSkeleton } from './chart-card';

describe('ChartCard', () => {
  it('shows the error message when error is true', () => {
    render(
      <ChartCard title="Trend" error errorMessage="Failed to load">
        <div>content</div>
      </ChartCard>,
    );
    expect(screen.getByText('Failed to load')).toBeInTheDocument();
    expect(screen.queryByText('content')).not.toBeInTheDocument();
  });

  it('renders children when not errored', () => {
    render(
      <ChartCard title="Trend" error={false} errorMessage="">
        <div>content</div>
      </ChartCard>,
    );
    expect(screen.getByText('Trend')).toBeInTheDocument();
    expect(screen.getByText('content')).toBeInTheDocument();
  });
});

describe('ChartSkeleton', () => {
  it('announces a loading chart with a pulsing placeholder', () => {
    const { container } = render(<ChartSkeleton />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading chart');
    expect(container.querySelector('.animate-pulse')).toHaveClass('h-56');
  });

  it('uses a custom size instead of the default', () => {
    const { container } = render(<ChartSkeleton className="h-[420px]" />);
    const skeleton = container.querySelector('.animate-pulse');
    expect(skeleton).toHaveClass('h-[420px]');
    expect(skeleton).not.toHaveClass('h-56');
  });
});
