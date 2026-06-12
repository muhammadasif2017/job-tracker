import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { EnrichmentStatus } from '@prisma/client';
import { EnrichmentService } from './enrichment.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ENRICHMENT_QUEUE } from './enrichment.processor.js';

const mockQueue = { add: jest.fn() };
const mockPrisma = { companyProfile: { upsert: jest.fn() } };

describe('EnrichmentService', () => {
  let service: EnrichmentService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.companyProfile.upsert.mockResolvedValue({});
    const module = await Test.createTestingModule({
      providers: [
        EnrichmentService,
        { provide: getQueueToken(ENRICHMENT_QUEUE), useValue: mockQueue },
        { provide: PrismaService, useValue: mockPrisma },
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

  it('upserts CompanyProfile to PENDING before adding to queue', async () => {
    mockQueue.add.mockResolvedValue({});

    await service.enqueueEnrichment('job-abc');

    expect(mockPrisma.companyProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { jobId: 'job-abc' },
        create: expect.objectContaining({ status: EnrichmentStatus.PENDING }),
        update: expect.objectContaining({ status: EnrichmentStatus.PENDING }),
      }),
    );
    // upsert must happen before queue.add
    const upsertOrder =
      mockPrisma.companyProfile.upsert.mock.invocationCallOrder[0];
    const queueOrder = mockQueue.add.mock.invocationCallOrder[0];
    expect(upsertOrder).toBeLessThan(queueOrder);
  });
});
