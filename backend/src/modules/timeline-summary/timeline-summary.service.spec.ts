import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { TimelineSummaryService } from './timeline-summary.service.js';
import { JOB_TIMELINE_SUMMARY_QUEUE } from './timeline-summary.constants.js';

const mockQueue = { add: jest.fn() };

describe('TimelineSummaryService', () => {
  let service: TimelineSummaryService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockQueue.add.mockResolvedValue({});
    const module = await Test.createTestingModule({
      providers: [
        TimelineSummaryService,
        {
          provide: getQueueToken(JOB_TIMELINE_SUMMARY_QUEUE),
          useValue: mockQueue,
        },
      ],
    }).compile();
    service = module.get(TimelineSummaryService);
  });

  it('enqueues with a bounded retry policy (2 attempts, fixed 10s backoff)', async () => {
    await service.enqueue('job-1');

    expect(mockQueue.add).toHaveBeenCalledWith(
      'summarize',
      { jobId: 'job-1' },
      {
        jobId: 'summarize-job-1',
        attempts: 2,
        backoff: { type: 'fixed', delay: 10_000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  });

  // The stable jobId only coalesces a burst if the finished job is cleaned
  // up: BullMQ skips an add whose jobId hash still exists in any state, and
  // keeps finished jobs by default, so leaving these unset would freeze each
  // job's summary at whatever the first run produced.
  it('clears the jobId on completion and permanent failure so later triggers can re-enqueue', async () => {
    await service.enqueue('job-3');

    expect(mockQueue.add).toHaveBeenCalledWith(
      'summarize',
      { jobId: 'job-3' },
      expect.objectContaining({ removeOnComplete: true, removeOnFail: true }),
    );
  });

  it('derives the BullMQ jobId from the payload jobId so repeated triggers on the same job coalesce', async () => {
    await service.enqueue('job-2');

    expect(mockQueue.add).toHaveBeenCalledWith(
      'summarize',
      { jobId: 'job-2' },
      expect.objectContaining({ jobId: 'summarize-job-2' }),
    );
  });
});
