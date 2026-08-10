import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatsCard } from './stats-card';

describe('StatsCard', () => {
  it('renders label, value, and sub text', () => {
    render(
      <StatsCard label="Total" value={42} sub="this month" icon={<svg />} />,
    );
    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('this month')).toBeInTheDocument();
  });

  it('shows a skeleton instead of the value while loading', () => {
    const { container } = render(
      <StatsCard label="Total" value={42} icon={<svg />} loading />,
    );
    expect(screen.queryByText('42')).not.toBeInTheDocument();
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('omits the sub text when not provided', () => {
    render(<StatsCard label="Total" value={42} icon={<svg />} />);
    expect(screen.queryByText('this month')).not.toBeInTheDocument();
  });
});
