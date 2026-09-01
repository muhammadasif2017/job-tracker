import type { Job } from 'bullmq';
import { WORKER_METADATA } from '@nestjs/bullmq/dist/bull.constants.js';
import { TimelineSummaryProcessor } from './timeline-summary.processor.js';
import { LlmService } from '../enrichment/services/llm.service.js';

const mockPrisma = {
  job: { findFirst: jest.fn(), update: jest.fn() },
  jobEvent: { findMany: jest.fn() },
};
const mockLlm = { summarizeEvents: jest.fn() } satisfies Pick<
  LlmService,
  'summarizeEvents'
>;
const mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

const dbJob = { id: 'job-1', company: 'Acme', position: 'Engineer' };
const events = [
  {
    id: 'event-1',
    jobId: 'job-1',
    type: 'CREATED',
    fromStatus: null,
    toStatus: 'APPLIED',
    note: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  },
];
const bullJob = { data: { jobId: 'job-1' } } as Job<{ jobId: string }>;

describe('TimelineSummaryProcessor', () => {
  it('sets a 90s lockDuration on the @Processor() worker options', () => {
    const workerOptions = Reflect.getMetadata(
      WORKER_METADATA,
      TimelineSummaryProcessor,
    ) as { lockDuration?: number } | undefined;

    expect(workerOptions).toEqual({ lockDuration: 90_000 });
  });

  let processor: TimelineSummaryProcessor;

  beforeEach(() => {
    jest.clearAllMocks();
    processor = new TimelineSummaryProcessor(
      mockPrisma as never,
      mockLlm as never,
      mockLogger as never,
    );
  });

  it('summarizes the event timeline and persists it on the job', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(dbJob);
    mockPrisma.jobEvent.findMany.mockResolvedValue(events);
    mockLlm.summarizeEvents.mockResolvedValue('Applied to Acme.');

    await processor.process(bullJob);

    expect(mockLlm.summarizeEvents).toHaveBeenCalledWith(events, {
      company: 'Acme',
      position: 'Engineer',
    });
    expect(mockPrisma.job.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: {
        timelineSummary: 'Applied to Acme.',
        timelineSummaryAt: expect.any(Date),
      },
    });
  });

  it('caps the event fetch and restores chronological order for the prompt', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(dbJob);
    const oldest = {
      ...events[0],
      id: 'event-1',
      createdAt: new Date('2026-01-01'),
    };
    const newest = {
      ...events[0],
      id: 'event-2',
      createdAt: new Date('2026-01-05'),
    };
    // Prisma returns desc order (newest first) for this query shape.
    mockPrisma.jobEvent.findMany.mockResolvedValue([newest, oldest]);
    mockLlm.summarizeEvents.mockResolvedValue('Applied to Acme.');

    await processor.process(bullJob);

    expect(mockPrisma.jobEvent.findMany).toHaveBeenCalledWith({
      where: { jobId: 'job-1' },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    // summarizeEvents must see oldest-first, matching how the prompt reads.
    expect(mockLlm.summarizeEvents).toHaveBeenCalledWith([oldest, newest], {
      company: 'Acme',
      position: 'Engineer',
    });
  });

  it('returns without calling the LLM when the job no longer exists', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(null);

    await processor.process(bullJob);

    expect(mockLlm.summarizeEvents).not.toHaveBeenCalled();
    expect(mockPrisma.job.update).not.toHaveBeenCalled();
  });

  it('returns without calling the LLM when there are no events', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(dbJob);
    mockPrisma.jobEvent.findMany.mockResolvedValue([]);

    await processor.process(bullJob);

    expect(mockLlm.summarizeEvents).not.toHaveBeenCalled();
    expect(mockPrisma.job.update).not.toHaveBeenCalled();
  });

  it('skips the persist when the job was deleted while the LLM call was in flight', async () => {
    mockPrisma.job.findFirst
      .mockResolvedValueOnce(dbJob) // initial fetch
      .mockResolvedValueOnce(null); // re-check after the LLM call
    mockPrisma.jobEvent.findMany.mockResolvedValue(events);
    mockLlm.summarizeEvents.mockResolvedValue('Applied to Acme.');

    await processor.process(bullJob);

    expect(mockPrisma.job.update).not.toHaveBeenCalled();
  });

  it('logs and re-throws when the LLM call fails', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(dbJob);
    mockPrisma.jobEvent.findMany.mockResolvedValue(events);
    mockLlm.summarizeEvents.mockRejectedValue(new Error('Groq down'));

    await expect(processor.process(bullJob)).rejects.toThrow('Groq down');
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'timeline_summary_failed',
      expect.objectContaining({ jobId: 'job-1' }),
    );
  });
});
