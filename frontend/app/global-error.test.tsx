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
    // Tagged with the boundary name and handed the raw error last; the
    // context object's fields are covered in `lib/log-error.test.ts`.
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[global]',
      expect.objectContaining({ message: 'boom', digest: 'abc123' }),
      error,
    );
  });

  it('calls unstable_retry when "Try again" is clicked', () => {
    const retry = vi.fn();
    render(<GlobalError error={new Error('boom')} unstable_retry={retry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  // This boundary replaces the root layout, so it never gets globals.css —
  // no Tailwind, no var(--token). The literal light-mode values are the only
  // thing standing between it and the 2.04:1 white-on-#ff9f45 button it used
  // to render, so pin them.
  it('paints the light-mode palette explicitly', () => {
    render(<GlobalError error={new Error('boom')} unstable_retry={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Try again' })).toHaveStyle({
      background: '#b45e07',
      color: '#ffffff',
    });
    expect(
      screen.getByText(
        'The application hit an unexpected error. Try reloading.',
      ),
    ).toHaveStyle({ color: '#626d7a' });
  });

  it('shows the generic error message', () => {
    render(<GlobalError error={new Error('boom')} unstable_retry={vi.fn()} />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(
      screen.getByText(
        'The application hit an unexpected error. Try reloading.',
      ),
    ).toBeInTheDocument();
  });
});
