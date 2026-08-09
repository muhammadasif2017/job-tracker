import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Spinner } from './spinner';

describe('Spinner', () => {
  it('renders a spinning svg with a default size', () => {
    const { container } = render(<Spinner />);
    const svg = container.querySelector('svg.animate-spin');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveClass('h-5', 'w-5');
  });

  it('uses a custom className instead of the default size', () => {
    const { container } = render(<Spinner className="h-10 w-10" />);
    const svg = container.querySelector('svg.animate-spin');
    expect(svg).toHaveClass('h-10', 'w-10');
    expect(svg).not.toHaveClass('h-5');
  });
});
