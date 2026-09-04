import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { EnrichmentStatus } from '@prisma/client';
import { CompanyEnrichmentService } from './company-enrichment.service.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { COMPANY_ENRICHMENT_QUEUE } from './company-enrichment.constants.js';

const mockPrisma = { company: { update: jest.fn(), updateMany: jest.fn() } };
const mockQueue = { add: jest.fn() };

describe('CompanyEnrichmentService', () => {
  let service: CompanyEnrichmentService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.company.update.mockResolvedValue({});
    mockPrisma.company.updateMany.mockResolvedValue({ count: 1 });
    mockQueue.add.mockResolvedValue({});
    const module = await Test.createTestingModule({
      providers: [
        CompanyEnrichmentService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: getQueueToken(COMPANY_ENRICHMENT_QUEUE),
          useValue: mockQueue,
        },
      ],
    }).compile();
    service = module.get(CompanyEnrichmentService);
  });

  it('marks the company PENDING and clears any prior error before enqueueing', async () => {
    await service.enqueueEnrichment('company-1');

    expect(mockPrisma.company.update).toHaveBeenCalledWith({
      where: { id: 'company-1' },
      data: { status: EnrichmentStatus.PENDING, errorMessage: null },
    });
  });

  it('enqueues with a bounded retry policy (2 attempts, fixed 10s backoff)', async () => {
    await service.enqueueEnrichment('company-1');

    expect(mockQueue.add).toHaveBeenCalledWith(
      'enrich',
      { companyId: 'company-1' },
      { attempts: 2, backoff: { type: 'fixed', delay: 10_000 } },
    );
  });

  it('marks PENDING before enqueueing, not after, so a status query mid-race sees PENDING rather than stale state', async () => {
    const order: string[] = [];
    mockPrisma.company.update.mockImplementation(() => {
      order.push('update');
      return Promise.resolve({});
    });
    mockQueue.add.mockImplementation(() => {
      order.push('add');
      return Promise.resolve({});
    });

    await service.enqueueEnrichment('company-1');

    expect(order).toEqual(['update', 'add']);
  });

  // ADR-035. enqueueEnrichment (the Refresh button) stays unconditional; only
  // the auto-trigger path from job creation is gated, so a company with N
  // jobs costs one enrichment run instead of N.
  describe('enqueueIfStale', () => {
    it('claims the row with a CAS that only matches a never-attempted company', async () => {
      await service.enqueueIfStale('company-1');

      expect(mockPrisma.company.updateMany).toHaveBeenCalledWith({
        where: { id: 'company-1', status: null, enrichedAt: null },
        data: { status: EnrichmentStatus.PENDING, errorMessage: null },
      });
    });

    it('enqueues with the same retry policy as enqueueEnrichment once it wins the claim', async () => {
      await service.enqueueIfStale('company-1');

      expect(mockQueue.add).toHaveBeenCalledWith(
        'enrich',
        { companyId: 'company-1' },
        { attempts: 2, backoff: { type: 'fixed', delay: 10_000 } },
      );
    });

    // count === 0 covers every skip case at once — COMPLETED, FAILED, and a
    // run already PENDING/PROCESSING all fail the WHERE. Queueing anyway
    // would re-burn the Tavily searches this gate exists to save.
    it('does not enqueue when the CAS matches nothing', async () => {
      mockPrisma.company.updateMany.mockResolvedValue({ count: 0 });

      await service.enqueueIfStale('company-1');

      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('never falls back to the unconditional update enqueueEnrichment uses', async () => {
      mockPrisma.company.updateMany.mockResolvedValue({ count: 0 });

      await service.enqueueIfStale('company-1');

      expect(mockPrisma.company.update).not.toHaveBeenCalled();
    });

    // Without this, a Redis outage leaves the row at PENDING with nothing
    // queued — which this method skips and triggerEnrichment's CAS rejects
    // with a 409, so the company could never be enriched again by any path.
    it('releases the claim when the enqueue fails, so the company stays recoverable', async () => {
      mockQueue.add.mockRejectedValue(new Error('Redis down'));

      await expect(service.enqueueIfStale('company-1')).rejects.toThrow(
        'Redis down',
      );

      expect(mockPrisma.company.updateMany).toHaveBeenLastCalledWith({
        where: { id: 'company-1', status: EnrichmentStatus.PENDING },
        data: { status: null },
      });
    });

    it('still surfaces the enqueue failure to the caller after releasing the claim', async () => {
      mockQueue.add.mockRejectedValue(new Error('Redis down'));
      // A rollback that itself fails must not mask the original error.
      mockPrisma.company.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockRejectedValueOnce(new Error('DB down'));

      await expect(service.enqueueIfStale('company-1')).rejects.toThrow(
        'Redis down',
      );
    });
  });
});
