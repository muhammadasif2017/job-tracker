import { describe, it, expect } from 'vitest';
import type { ErrorEvent } from '@sentry/nextjs';
import { sharedSentryOptions, withoutIpAddress } from './sentry-options';

describe('withoutIpAddress', () => {
  it('drops the IP address and keeps the rest of the user', () => {
    const event = {
      user: { id: 'u1', ip_address: '203.0.113.7' },
    } as ErrorEvent;

    expect(withoutIpAddress(event).user).toEqual({ id: 'u1' });
  });

  it('leaves an event without a user untouched', () => {
    const event = { message: 'boom' } as ErrorEvent;

    expect(withoutIpAddress(event)).toEqual({ message: 'boom' });
  });
});

describe('sharedSentryOptions', () => {
  it('turns off tracing and every kind of personal data collection', () => {
    const options = sharedSentryOptions();

    expect(options.tracesSampleRate).toBe(0);
    expect(options.dataCollection).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
    });
    expect(options.beforeSend).toBe(withoutIpAddress);
  });
});
