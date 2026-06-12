import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { EnrichmentService } from './enrichment.service.js';
import { ENRICHMENT_QUEUE } from './enrichment.processor.js';

const mockQueue = { add: jest.fn() };

describe('EnrichmentService', () => {
  let service: EnrichmentService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        EnrichmentService,
        { provide: getQueueToken(ENRICHMENT_QUEUE), useValue: mockQueue },
      ],
    }).compile();
    service = module.get(EnrichmentService);
  });

  it('adds the jobId to the company-enrichment queue', async () => {
    mockQueue.add.mockResolvedValue({});

    await service.enqueueEnrichment('job-abc');

    expect(mockQueue.add).toHaveBeenCalledWith(
      'enrich',
      { jobId: 'job-abc' },
      expect.objectContaining({ attempts: 2 }),
    );
  });

  it('uses a fixed backoff between retries', async () => {
    mockQueue.add.mockResolvedValue({});

    await service.enqueueEnrichment('job-xyz');

    const opts = mockQueue.add.mock.calls[0][2] as {
      backoff: { type: string };
    };
    expect(opts.backoff.type).toBe('fixed');
  });
});
