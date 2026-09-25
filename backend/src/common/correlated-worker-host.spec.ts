import type { Job } from 'bullmq';
import { CorrelatedWorkerHost } from './correlated-worker-host.js';
import { currentRequestId } from './request-context.helper.js';

/** A processor that records the correlation ID its handle() ran under. */
class ProbeProcessor extends CorrelatedWorkerHost {
  seen: Array<{ requestId?: string; token?: string }> = [];

  protected handle(_job: Job, token?: string): Promise<string> {
    this.seen.push({ requestId: currentRequestId(), token });
    return Promise.resolve('done');
  }
}

function job(data: object, id = '7'): Job {
  return { id, queueName: 'probe', data } as unknown as Job;
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
});
