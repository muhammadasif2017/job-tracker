import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from './button';

describe('Button', () => {
  it('defaults to type="button" and calls onClick', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn).toHaveAttribute('type', 'button');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalled();
  });

  it('is disabled and shows a spinner while loading, without calling onClick', () => {
    const onClick = vi.fn();
    const { container } = render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn).toBeDisabled();
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('is disabled when disabled prop is set', () => {
    render(<Button disabled>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('respects an explicit type override', () => {
    render(<Button type="submit">Submit</Button>);
    expect(screen.getByRole('button', { name: 'Submit' })).toHaveAttribute(
      'type',
      'submit',
    );
  });

  it('draws the accent focus ring on neutral variants', () => {
    render(<Button variant="secondary">Cancel</Button>);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveClass(
      'focus-visible:ring-accent',
    );
  });

  it('keeps the danger focus ring on the danger variant', () => {
    render(<Button variant="danger">Delete</Button>);
    const btn = screen.getByRole('button', { name: 'Delete' });
    expect(btn).toHaveClass('focus-visible:ring-danger');
    expect(btn).not.toHaveClass('focus-visible:ring-accent');
  });
});
