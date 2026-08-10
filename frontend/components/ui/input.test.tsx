import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Input } from './input';

describe('Input', () => {
  it('links the label to the input via id derived from the label', () => {
    render(<Input label="Email Address" />);
    expect(screen.getByLabelText('Email Address')).toBeInTheDocument();
  });

  it('shows the error message and not the hint when both are given', () => {
    render(<Input label="Email" error="Required" hint="We never share this" />);
    expect(screen.getByText('Required')).toBeInTheDocument();
    expect(screen.queryByText('We never share this')).not.toBeInTheDocument();
  });

  it('shows the hint when there is no error', () => {
    render(<Input label="Email" hint="We never share this" />);
    expect(screen.getByText('We never share this')).toBeInTheDocument();
  });

  it('toggles a password field between hidden and visible text', () => {
    render(<Input label="Password" type="password" />);
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByLabelText('Show password'));
    expect(input).toHaveAttribute('type', 'text');
    fireEvent.click(screen.getByLabelText('Hide password'));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('does not render a visibility toggle for non-password inputs', () => {
    render(<Input label="Email" type="email" />);
    expect(screen.queryByLabelText('Show password')).not.toBeInTheDocument();
  });
});
