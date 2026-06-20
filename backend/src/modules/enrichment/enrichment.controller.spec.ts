import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { EnrichmentController } from './enrichment.controller.js';
import { EnrichmentService } from './enrichment.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

const mockPrisma = {
  job: { findFirst: jest.fn() },
  companyProfile: { findFirst: jest.fn() },
};
const mockEnrichment = { enqueueEnrichment: jest.fn() };
const user = { id: 'user-1' };

describe('EnrichmentController', () => {
  let controller: EnrichmentController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [EnrichmentController],
      providers: [
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EnrichmentService, useValue: mockEnrichment },
      ],
    }).compile();
    controller = module.get(EnrichmentController);
  });

  it('returns { message } and enqueues when job belongs to user', async () => {
    mockPrisma.job.findFirst.mockResolvedValue({ id: 'job-1' });
    mockPrisma.companyProfile.findFirst.mockResolvedValue(null);
    mockEnrichment.enqueueEnrichment.mockResolvedValue(undefined);

    const result = await controller.triggerEnrichment(user, 'job-1');

    expect(result).toEqual({ message: 'Enrichment queued' });
    expect(mockEnrichment.enqueueEnrichment).toHaveBeenCalledWith('job-1');
  });

  it('scopes the ownership check to the authenticated user', async () => {
    mockPrisma.job.findFirst.mockResolvedValue({ id: 'job-1' });
    mockPrisma.companyProfile.findFirst.mockResolvedValue(null);
    mockEnrichment.enqueueEnrichment.mockResolvedValue(undefined);

    await controller.triggerEnrichment(user, 'job-1');

    expect(mockPrisma.job.findFirst).toHaveBeenCalledWith({
      where: { id: 'job-1', userId: 'user-1' },
    });
  });

  it('throws NotFoundException when job is not found or belongs to another user', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(null);

    await expect(controller.triggerEnrichment(user, 'job-99')).rejects.toThrow(
      NotFoundException,
    );
    expect(mockEnrichment.enqueueEnrichment).not.toHaveBeenCalled();
  });

  it.each(['PENDING', 'PROCESSING'])(
    'throws ConflictException when enrichment is already %s',
    async (status) => {
      mockPrisma.job.findFirst.mockResolvedValue({ id: 'job-1' });
      mockPrisma.companyProfile.findFirst.mockResolvedValue({ status });

      await expect(controller.triggerEnrichment(user, 'job-1')).rejects.toThrow(
        ConflictException,
      );
      expect(mockEnrichment.enqueueEnrichment).not.toHaveBeenCalled();
    },
  );
});
