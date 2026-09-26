import { Logger } from '@nestjs/common';
import { appLogger } from './app-logger.helper.js';
import { isAppLogContext } from './app-log-contexts.helper.js';

describe('appLogger', () => {
  it("returns Nest's Logger with the class name as its context", () => {
    class BillingService {}

    const logger = appLogger(BillingService);

    expect(logger).toBeInstanceOf(Logger);
    expect((logger as unknown as { context: string }).context).toBe(
      'BillingService',
    );
  });

  it('records the context as one of our own', () => {
    appLogger({ name: 'RecordedService' });

    expect(isAppLogContext('RecordedService')).toBe(true);
  });

  it('does not recognise contexts it never created, or non-strings', () => {
    expect(isAppLogContext('HealthCheckService')).toBe(false);
    expect(isAppLogContext('Error: boom\n    at x')).toBe(false);
    expect(isAppLogContext({ name: 'RecordedService' })).toBe(false);
  });
});
