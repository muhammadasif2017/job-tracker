import { describe, it, expect, vi, afterEach } from 'vitest';
import { captureException } from '@sentry/browser';
import { logBoundaryError } from './log-error';

vi.mock('@sentry/browser', () => ({ captureException: vi.fn() }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(captureException).mockClear();
});

describe('logBoundaryError', () => {
  it('tags the boundary and includes the digest and path', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = Object.assign(new Error('boom'), { digest: 'abc123' });

    logBoundaryError(error, 'dashboard');

    expect(spy).toHaveBeenCalledOnce();
    const [tag, context, passed] = spy.mock.calls[0];
    expect(tag).toBe('[dashboard]');
    expect(context).toMatchObject({
      message: 'boom',
      digest: 'abc123',
      path: window.location.pathname,
    });
    // The raw error goes last so devtools keeps the expandable stack.
    expect(passed).toBe(error);
  });

  it('leaves digest undefined for a client-side error that has none', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    logBoundaryError(new Error('boom'), 'app');

    expect(spy.mock.calls[0][1]).toMatchObject({ digest: undefined });
  });

  it('reports a client-side error to Sentry with the boundary tag', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error('boom');

    logBoundaryError(error, 'dashboard');

    expect(captureException).toHaveBeenCalledWith(error, {
      tags: { boundary: 'dashboard' },
    });
  });

  it('does not report a server error, which the server already reported', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = Object.assign(new Error('boom'), { digest: 'abc123' });

    logBoundaryError(error, 'dashboard');

    expect(captureException).not.toHaveBeenCalled();
  });
});
