import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GlobalError from './global-error';

describe('GlobalError', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('logs the error on mount', () => {
    const error = Object.assign(new Error('boom'), { digest: 'abc123' });
    render(<GlobalError error={error} unstable_retry={vi.fn()} />);
    expect(consoleErrorSpy).toHaveBeenCalledWith(error);
  });

  it('calls unstable_retry when "Try again" is clicked', () => {
    const retry = vi.fn();
    render(<GlobalError error={new Error('boom')} unstable_retry={retry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('shows the generic error message', () => {
    render(<GlobalError error={new Error('boom')} unstable_retry={vi.fn()} />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(
      screen.getByText('The application hit an unexpected error. Try reloading.'),
    ).toBeInTheDocument();
  });
});
