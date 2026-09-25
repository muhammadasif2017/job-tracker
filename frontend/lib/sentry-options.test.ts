import { describe, it, expect } from 'vitest';
import type { ErrorEvent } from '@sentry/nextjs';
import {
  sharedSentryOptions,
  tunnelFor,
  withoutIpAddress,
  withoutNavigationQuery,
} from './sentry-options';

describe('tunnelFor', () => {
  it('adds the org, project and region that the tunnel rewrite matches on', () => {
    expect(tunnelFor('https://key@o123.ingest.us.sentry.io/456')).toBe(
      '/monitoring?o=123&p=456&r=us',
    );
  });

  it('leaves out the region for a DSN without one', () => {
    expect(tunnelFor('https://key@o123.ingest.sentry.io/456')).toBe(
      '/monitoring?o=123&p=456',
    );
  });

  it('gives no tunnel for a self-hosted or malformed DSN', () => {
    expect(tunnelFor('https://key@sentry.example.com/456')).toBeUndefined();
    expect(tunnelFor('not a dsn')).toBeUndefined();
  });
});

describe('withoutNavigationQuery', () => {
  it('drops the query from both ends of a navigation', () => {
    const crumb = withoutNavigationQuery({
      category: 'navigation',
      data: { from: '/callback?code=secret', to: '/jobs?q=acme' },
    });

    expect(crumb.data).toEqual({ from: '/callback', to: '/jobs' });
  });

  it('leaves other breadcrumbs untouched', () => {
    const crumb = { category: 'ui.click', message: 'button' };

    expect(withoutNavigationQuery(crumb)).toBe(crumb);
  });
});

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
