import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DashboardNotFound from './not-found';

describe('DashboardNotFound', () => {
  it('shows the not-found message', () => {
    render(<DashboardNotFound />);
    expect(screen.getByText('Page not found')).toBeInTheDocument();
  });

  it('links back to the dashboard', () => {
    render(<DashboardNotFound />);
    expect(screen.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute(
      'href',
      '/',
    );
  });
});
