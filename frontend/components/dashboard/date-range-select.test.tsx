import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DateRangeSelect } from './date-range-select';

describe('DateRangeSelect', () => {
  it('marks the current value as pressed', () => {
    render(<DateRangeSelect value="30d" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: '30d' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: '90d' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('calls onChange with the clicked range', () => {
    const onChange = vi.fn();
    render(<DateRangeSelect value="30d" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(onChange).toHaveBeenCalledWith('all');
  });
});
