import type { Queue } from 'bullmq';
import { readQueueCounts } from './queue-counts.helper.js';
import { COUNTED_STATES } from './admin-queues.constants.js';

describe('readQueueCounts', () => {
  it('asks for the counted states by name and returns them', async () => {
    const getJobCounts = jest.fn().mockResolvedValue({
      waiting: 3,
      active: 1,
      delayed: 0,
      failed: 2,
      completed: 9,
    });

    const counts = await readQueueCounts({ getJobCounts } as unknown as Queue);

    expect(getJobCounts).toHaveBeenCalledWith(...COUNTED_STATES);
    expect(counts).toEqual({
      waiting: 3,
      active: 1,
      delayed: 0,
      failed: 2,
      completed: 9,
    });
  });

  it('fills a state BullMQ left out with 0', async () => {
    const getJobCounts = jest.fn().mockResolvedValue({ waiting: 4 });

    const counts = await readQueueCounts({ getJobCounts } as unknown as Queue);

    expect(counts).toEqual({
      waiting: 4,
      active: 0,
      delayed: 0,
      failed: 0,
      completed: 0,
    });
  });

  it('lets a Redis failure through for the caller to handle', async () => {
    const getJobCounts = jest
      .fn()
      .mockRejectedValue(new Error('Command timed out'));

    await expect(
      readQueueCounts({ getJobCounts } as unknown as Queue),
    ).rejects.toThrow('Command timed out');
  });
});
