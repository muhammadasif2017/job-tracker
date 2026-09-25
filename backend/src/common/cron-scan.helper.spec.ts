import { runCronScan } from './cron-scan.helper.js';
import { currentRequestId } from './request-context.helper.js';
import { reportError } from '../infrastructure/error-tracking/error-tracking.helper.js';

jest.mock('../infrastructure/error-tracking/error-tracking.helper.js', () => ({
  reportError: jest.fn(),
}));

describe('runCronScan', () => {
  beforeEach(() => jest.clearAllMocks());

  it('runs the scan under a reserved cron correlation ID', async () => {
    const seen = await runCronScan('daily-digests', () =>
      Promise.resolve(currentRequestId()),
    );

    expect(seen).toMatch(/^cron:daily-digests:\d{4}-\d{2}-\d{2}T/);
    expect(reportError).not.toHaveBeenCalled();
  });

  it('reports a failure inside the scan context, then rethrows it', async () => {
    const err = new Error('scan failed');
    let idAtReport: string | undefined;
    jest.mocked(reportError).mockImplementationOnce(() => {
      idAtReport = currentRequestId();
    });

    await expect(
      runCronScan('interview-reminders', () => Promise.reject(err)),
    ).rejects.toBe(err);

    expect(reportError).toHaveBeenCalledWith(err, {
      tags: { cron: 'interview-reminders' },
    });
    expect(idAtReport).toMatch(/^cron:interview-reminders:/);
  });
});
