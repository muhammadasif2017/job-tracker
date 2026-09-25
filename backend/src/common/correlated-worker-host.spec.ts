import { DelayedError, UnrecoverableError, type Job } from 'bullmq';
import { CorrelatedWorkerHost } from './correlated-worker-host.js';
import { currentRequestId } from './request-context.helper.js';
import { reportError } from '../infrastructure/error-tracking/error-tracking.helper.js';

jest.mock('../infrastructure/error-tracking/error-tracking.helper.js', () => ({
  reportError: jest.fn(),
}));

/** A processor that records the correlation ID its handle() ran under. */
class ProbeProcessor extends CorrelatedWorkerHost {
  seen: Array<{ requestId?: string; token?: string }> = [];

  protected handle(_job: Job, token?: string): Promise<string> {
    this.seen.push({ requestId: currentRequestId(), token });
    return Promise.resolve('done');
  }
}

function job(
  data: object,
  id = '7',
  attempts = { attemptsMade: 0, allowed: 1 },
): Job {
  return {
    id,
    name: 'probe-job',
    queueName: 'probe',
    data,
    attemptsMade: attempts.attemptsMade,
    opts: { attempts: attempts.allowed },
  } as unknown as Job;
}

/** A processor whose handle() always throws the given error. */
class FailingProcessor extends CorrelatedWorkerHost {
  constructor(private readonly error: Error) {
    super();
  }

  protected handle(): Promise<never> {
    return Promise.reject(this.error);
  }
}

describe('CorrelatedWorkerHost', () => {
  it('runs handle() under the requestId the job carries', async () => {
    const processor = new ProbeProcessor();

    await expect(
      processor.process(job({ requestId: 'req-from-api' }), 'tok'),
    ).resolves.toBe('done');

    expect(processor.seen).toEqual([
      { requestId: 'req-from-api', token: 'tok' },
    ]);
  });

  it('falls back to an ID built from the job when none was carried', async () => {
    const processor = new ProbeProcessor();

    await processor.process(job({}, '42'));

    expect(processor.seen[0].requestId).toBe('job:probe:42');
  });

  it('leaves no context behind once the job finishes', async () => {
    await new ProbeProcessor().process(job({ requestId: 'req-x' }));

    expect(currentRequestId()).toBeUndefined();
  });

  describe('Sentry reporting (ADR-050)', () => {
    beforeEach(() => jest.clearAllMocks());

    it('reports a failure on the last allowed attempt, tagged with its queue', async () => {
      const err = new Error('extraction failed');
      await expect(
        new FailingProcessor(err).process(
          job({ requestId: 'req-9' }, '9', { attemptsMade: 1, allowed: 2 }),
        ),
      ).rejects.toBe(err);

      expect(reportError).toHaveBeenCalledWith(err, {
        tags: { queue: 'probe', jobName: 'probe-job' },
        extra: { jobId: '9', attemptsMade: 1 },
      });
    });

    it('does not report a failure BullMQ will retry', async () => {
      await expect(
        new FailingProcessor(new Error('transient')).process(
          job({}, '9', { attemptsMade: 0, allowed: 2 }),
        ),
      ).rejects.toThrow('transient');

      expect(reportError).not.toHaveBeenCalled();
    });

    it('reports an UnrecoverableError even on the first attempt', async () => {
      const err = new UnrecoverableError('search quota exceeded');
      await expect(
        new FailingProcessor(err).process(
          job({}, '9', { attemptsMade: 0, allowed: 2 }),
        ),
      ).rejects.toBe(err);

      expect(reportError).toHaveBeenCalled();
    });

    it('never reports a deliberate DelayedError', async () => {
      await expect(
        new FailingProcessor(new DelayedError()).process(
          job({}, '9', { attemptsMade: 1, allowed: 2 }),
        ),
      ).rejects.toBeInstanceOf(DelayedError);

      expect(reportError).not.toHaveBeenCalled();
    });

    it('treats an UnrecoverableError from another bullmq copy as final, by name', async () => {
      const foreign = Object.assign(new Error('quota'), {
        name: 'UnrecoverableError',
      });
      await expect(
        new FailingProcessor(foreign).process(
          job({}, '9', { attemptsMade: 0, allowed: 2 }),
        ),
      ).rejects.toBe(foreign);

      expect(reportError).toHaveBeenCalled();
    });

    it.each(['WaitingChildrenError', 'WaitingError', 'RateLimitError'])(
      'never reports the %s control-flow error, even on the last attempt',
      async (name) => {
        const steer = Object.assign(new Error('steer'), { name });
        await expect(
          new FailingProcessor(steer).process(
            job({}, '9', { attemptsMade: 1, allowed: 2 }),
          ),
        ).rejects.toBe(steer);

        expect(reportError).not.toHaveBeenCalled();
      },
    );
  });
});
