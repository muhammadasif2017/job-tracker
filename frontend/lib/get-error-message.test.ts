import { describe, it, expect } from 'vitest';
import { AxiosError } from 'axios';
import { getErrorMessage } from './api';

function axiosErrorWithMessage(message: unknown): AxiosError {
  const err = new AxiosError('Request failed');
  err.response = {
    data: { message },
    status: 400,
    statusText: 'Bad Request',
    headers: {},
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
});
