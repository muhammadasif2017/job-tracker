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

  it('reports to Sentry with the boundary tag and the digest', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = Object.assign(new Error('boom'), { digest: 'abc123' });

    logBoundaryError(error, 'dashboard');

    expect(captureException).toHaveBeenCalledWith(error, {
      tags: { boundary: 'dashboard' },
      extra: { digest: 'abc123' },
    });
  });
});
