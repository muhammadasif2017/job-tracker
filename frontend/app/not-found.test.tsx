import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import NotFound from './not-found';

describe('NotFound', () => {
  it('shows the not-found message', () => {
    render(<NotFound />);
    expect(screen.getByText('Page not found')).toBeInTheDocument();
  });

  it('links back to the dashboard', () => {
    render(<NotFound />);
    expect(screen.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute(
      'href',
      '/',
    );
  });
});
