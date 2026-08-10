import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Skeleton } from './skeleton';

describe('Skeleton', () => {
  it('renders a pulsing placeholder', () => {
    const { container } = render(<Skeleton />);
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('merges a custom className', () => {
    const { container } = render(<Skeleton className="h-8 w-20" />);
    const el = container.querySelector('.animate-pulse');
    expect(el).toHaveClass('h-8', 'w-20');
  });
});
