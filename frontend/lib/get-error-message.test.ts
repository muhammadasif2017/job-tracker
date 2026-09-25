import { describe, it, expect } from 'vitest';
import { AxiosError } from 'axios';
import { getErrorMessage } from './api';

function axiosErrorWithMessage(
  message: unknown,
  status = 400,
  extra: { data?: object; headers?: Record<string, string> } = {},
): AxiosError {
  const err = new AxiosError('Request failed');
  err.response = {
    data: { message, ...extra.data },
    status,
    statusText: 'Error',
    headers: extra.headers ?? {},
    config: err.config!,
  };
  return err;
}

describe('getErrorMessage', () => {
  it('joins a class-validator array message into one readable string', () => {
    const err = axiosErrorWithMessage([
      'company must not be empty',
      'url must be a URL address',
    ]);
    expect(getErrorMessage(err, 'fallback')).toBe(
      'company must not be empty. url must be a URL address',
    );
  });

  it('passes through a plain string message unchanged', () => {
    const err = axiosErrorWithMessage('Duplicate contact');
    expect(getErrorMessage(err, 'fallback')).toBe('Duplicate contact');
  });

  it('falls back when the axios error has no message', () => {
    const err = axiosErrorWithMessage(undefined);
    expect(getErrorMessage(err, 'fallback')).toBe('fallback');
  });

  it('falls back on a non-axios error', () => {
    expect(getErrorMessage(new Error('boom'), 'fallback')).toBe('fallback');
  });

  it('falls back on an empty array message instead of returning an empty string', () => {
    const err = axiosErrorWithMessage([]);
    expect(getErrorMessage(err, 'fallback')).toBe('fallback');
  });

  it('falls back when message is a non-string, non-array value', () => {
    const err = axiosErrorWithMessage({ unexpected: 'shape' });
    expect(getErrorMessage(err, 'fallback')).toBe('fallback');
  });

  it('appends the reference ID to a server error, from the body', () => {
    const err = axiosErrorWithMessage('Internal server error', 500, {
      data: { requestId: 'req-500-body' },
    });
    expect(getErrorMessage(err, 'fallback')).toBe(
      'Internal server error (ref: req-500-body)',
    );
  });

  it('falls back to the X-Request-Id header when the body has no ID', () => {
    const err = axiosErrorWithMessage(undefined, 503, {
      headers: { 'x-request-id': 'req-503-header' },
    });
    expect(getErrorMessage(err, 'Something went wrong')).toBe(
      'Something went wrong (ref: req-503-header)',
    );
  });

  it('leaves a client error message untouched even when an ID is present', () => {
    const err = axiosErrorWithMessage('Job not found', 404, {
      data: { requestId: 'req-404' },
    });
    expect(getErrorMessage(err, 'fallback')).toBe('Job not found');
  });

  it('adds nothing to a server error that carries no ID', () => {
    const err = axiosErrorWithMessage('Bad gateway', 502);
    expect(getErrorMessage(err, 'fallback')).toBe('Bad gateway');
  });
});
