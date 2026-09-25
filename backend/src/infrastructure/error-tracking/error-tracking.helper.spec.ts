import * as Sentry from '@sentry/nestjs';
import { reportError } from './error-tracking.helper.js';
import { runWithRequestId } from '../../common/request-context.helper.js';

const scope = {
  setTag: jest.fn(),
  setTags: jest.fn(),
  setUser: jest.fn(),
  setExtras: jest.fn(),
};

jest.mock('@sentry/nestjs', () => ({
  withScope: jest.fn((callback: (s: unknown) => void) => callback(scope)),
  captureException: jest.fn(),
}));

describe('reportError', () => {
  beforeEach(() => jest.clearAllMocks());

  it('captures the error with its correlation ID, user and tags', () => {
    const err = new Error('boom');

    reportError(err, {
      requestId: 'req-1',
      userId: 'u-1',
      tags: { queue: 'company-target-enrichment' },
      extra: { jobId: '9' },
    });

    expect(scope.setTag).toHaveBeenCalledWith('requestId', 'req-1');
    expect(scope.setUser).toHaveBeenCalledWith({ id: 'u-1' });
    expect(scope.setTags).toHaveBeenCalledWith({
      queue: 'company-target-enrichment',
    });
    expect(scope.setExtras).toHaveBeenCalledWith({ jobId: '9' });
    expect(Sentry.captureException).toHaveBeenCalledWith(err);
  });

  it('falls back to the correlation ID of the current request or job', () => {
    runWithRequestId('req-from-context', () => reportError(new Error('boom')));

    expect(scope.setTag).toHaveBeenCalledWith('requestId', 'req-from-context');
  });

  it('sends no user or requestId when there is none', () => {
    reportError(new Error('boom'));

    expect(scope.setUser).not.toHaveBeenCalled();
    expect(scope.setTag).not.toHaveBeenCalled();
    expect(Sentry.captureException).toHaveBeenCalled();
  });
});
