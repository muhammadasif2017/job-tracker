import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyChartState } from './empty-chart-state';

describe('EmptyChartState', () => {
  it('renders the no-data message', () => {
    render(<EmptyChartState />);
    expect(screen.getByText('No data yet')).toBeInTheDocument();
  });
});
