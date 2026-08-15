import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { EnrichmentStatus } from '@prisma/client';
import { CompanyEnrichmentService } from './company-enrichment.service.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { COMPANY_ENRICHMENT_QUEUE } from './company-enrichment.constants.js';

const mockPrisma = { company: { update: jest.fn() } };
const mockQueue = { add: jest.fn() };

describe('CompanyEnrichmentService', () => {
  let service: CompanyEnrichmentService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.company.update.mockResolvedValue({});
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
});
