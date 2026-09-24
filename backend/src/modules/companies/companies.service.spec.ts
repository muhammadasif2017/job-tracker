import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { EnrichmentStatus } from '@prisma/client';
import { CompaniesService } from './companies.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CompanyEnrichmentService } from './enrichment/company-enrichment.service.js';
import { Logger } from 'nestjs-pino';

const mockPrisma = {
  company: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findFirstOrThrow: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
    delete: jest.fn(),
  },
  job: { updateMany: jest.fn(), groupBy: jest.fn(), findMany: jest.fn() },
  contact: { updateMany: jest.fn() },
  // Mirrors Prisma's interactive-transaction shape closely enough for unit
  // tests: hands the callback the same mock client, ignoring isolationLevel.
  $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(mockPrisma)),
};

const mockCompanyEnrichment = {
  enqueueEnrichment: jest.fn(),
} satisfies Pick<CompanyEnrichmentService, 'enqueueEnrichment'>;

const mockLogger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };

describe('CompaniesService', () => {
  let service: CompaniesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCompanyEnrichment.enqueueEnrichment.mockResolvedValue(undefined);
    mockPrisma.company.count.mockResolvedValue(0);
    mockPrisma.job.groupBy.mockResolvedValue([]);
    const module = await Test.createTestingModule({
      providers: [
        CompaniesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CompanyEnrichmentService, useValue: mockCompanyEnrichment },
        { provide: Logger, useValue: mockLogger },
      ],
    }).compile();
    service = module.get(CompaniesService);
  });

  describe('create', () => {
    it('throws BadRequestException at the per-user company cap, before checking name uniqueness', async () => {
      mockPrisma.company.count.mockResolvedValue(2000);

      await expect(
        service.create('user-1', { name: 'One More Co', city: 'LAHORE' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.company.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.company.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException on a case-insensitive duplicate name', async () => {
      mockPrisma.company.findFirst.mockResolvedValue({ id: 'existing-1' });

      await expect(
        service.create('user-1', { name: 'systems limited', city: 'LAHORE' }),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.company.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the Serializable transaction detects a concurrent duplicate (P2034)', async () => {
      mockPrisma.company.findFirst.mockResolvedValue(null);
      mockPrisma.$transaction.mockRejectedValueOnce({ code: 'P2034' });

      await expect(
        service.create('user-1', { name: 'Systems Limited', city: 'LAHORE' }),
      ).rejects.toThrow(ConflictException);
    });

    it('runs the duplicate check and the write inside a Serializable transaction', async () => {
      mockPrisma.company.findFirst.mockResolvedValue(null);
      mockPrisma.company.create.mockResolvedValue({ id: 'company-1' });

      await service.create('user-1', {
        name: 'Systems Limited',
        city: 'LAHORE',
      });

      expect(mockPrisma.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ isolationLevel: 'Serializable' }),
      );
    });

    it('creates the company scoped to the user', async () => {
      mockPrisma.company.findFirst.mockResolvedValue(null);
      mockPrisma.company.create.mockResolvedValue({ id: 'company-1' });

      await service.create('user-1', {
        name: 'Systems Limited',
        city: 'LAHORE',
      });

      expect(mockPrisma.company.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          name: 'Systems Limited',
          city: 'LAHORE',
          techStack: [],
        }),
      });
    });

    it('auto-triggers enrichment after creating the company', async () => {
      mockPrisma.company.create.mockResolvedValue({ id: 'company-1' });

      await service.create('user-1', {
        name: 'Systems Limited',
        city: 'LAHORE',
      });

      expect(mockCompanyEnrichment.enqueueEnrichment).toHaveBeenCalledWith(
        'company-1',
      );
    });

    it('returns the company with status PENDING when enqueue succeeds', async () => {
      mockPrisma.company.create.mockResolvedValue({
        id: 'company-1',
        status: null,
      });

      const result = await service.create('user-1', {
        name: 'Systems Limited',
        city: 'LAHORE',
      });

      expect(result).toMatchObject({ status: 'PENDING', errorMessage: null });
    });

    it('still returns the created company even if enqueueEnrichment throws', async () => {
      mockPrisma.company.create.mockResolvedValue({
        id: 'company-1',
        status: null,
      });
      mockCompanyEnrichment.enqueueEnrichment.mockRejectedValue(
        new Error('Redis down'),
      );

      const result = await service.create('user-1', {
        name: 'Systems Limited',
        city: 'LAHORE',
      });

      expect(result).toMatchObject({ id: 'company-1', status: null });
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('scopes the list to the user and applies city/priority filters', async () => {
      mockPrisma.company.findMany.mockResolvedValue([{ id: 'c1' }]);
      mockPrisma.company.count.mockResolvedValue(1);

      const result = await service.findAll('user-1', {
        page: 1,
        limit: 10,
        city: 'KARACHI',
        priority: 'HIGH',
      });

      expect(mockPrisma.company.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', city: 'KARACHI', priority: 'HIGH' },
        }),
      );
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      });
    });

    it("attaches application stats computed for the page's companies only", async () => {
      mockPrisma.company.findMany.mockResolvedValue([
        { id: 'c1' },
        { id: 'c2' },
      ]);
      mockPrisma.company.count.mockResolvedValue(12);
      mockPrisma.job.groupBy
        .mockResolvedValueOnce([
          { companyId: 'c1', _count: { _all: 2 }, _max: { appliedAt: null } },
        ])
        .mockResolvedValueOnce([{ companyId: 'c1', _count: { _all: 1 } }])
        .mockResolvedValueOnce([]);

      const result = await service.findAll('user-1', { page: 1, limit: 2 });

      expect(mockPrisma.job.groupBy).toHaveBeenCalledTimes(3);
      expect(mockPrisma.job.groupBy.mock.calls[0][0].where.companyId).toEqual({
        in: ['c1', 'c2'],
      });
      expect(result.data).toEqual([
        {
          id: 'c1',
          applicationStats: {
            applied: 2,
            replied: 1,
            ghosted: 0,
            replyRate: 50,
            lastAppliedAt: null,
          },
        },
        {
          id: 'c2',
          applicationStats: {
            applied: 0,
            replied: 0,
            ghosted: 0,
            replyRate: 0,
            lastAppliedAt: null,
          },
        },
      ]);
    });
  });

  describe('findApplicationHistory', () => {
    it('returns nothing without querying for a blank name', async () => {
      const result = await service.findApplicationHistory('user-1', '   ');

      expect(result).toEqual({ company: null, stats: null, recentJobs: [] });
      expect(mockPrisma.company.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.job.groupBy).not.toHaveBeenCalled();
    });

    it('returns nothing for an unknown name', async () => {
      mockPrisma.company.findFirst.mockResolvedValue(null);

      const result = await service.findApplicationHistory('user-1', 'Nope');

      expect(result).toEqual({ company: null, stats: null, recentJobs: [] });
      expect(mockPrisma.job.findMany).not.toHaveBeenCalled();
    });

    it("matches the trimmed name case-insensitively within the user's companies", async () => {
      mockPrisma.company.findFirst.mockResolvedValue({
        id: 'c1',
        name: 'Systems Limited',
      });
      const jobs = [
        { id: 'j1', position: 'Dev', status: 'APPLIED', appliedAt: new Date() },
      ];
      mockPrisma.job.findMany.mockResolvedValue(jobs);

      const result = await service.findApplicationHistory(
        'user-1',
        '  systems limited ',
      );

      expect(mockPrisma.company.findFirst).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          name: { equals: 'systems limited', mode: 'insensitive' },
        },
        select: { id: true, name: true },
      });
      expect(mockPrisma.job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', companyId: 'c1' },
          take: 3,
        }),
      );
      expect(result).toEqual({
        company: { id: 'c1', name: 'Systems Limited' },
        stats: {
          applied: 0,
          replied: 0,
          ghosted: 0,
          replyRate: 0,
          lastAppliedAt: null,
        },
        recentJobs: jobs,
      });
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when the company does not belong to the user', async () => {
      mockPrisma.company.findFirst.mockResolvedValue(null);

      await expect(service.findOne('user-1', 'company-x')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns the company with its contacts', async () => {
      mockPrisma.company.findFirst.mockResolvedValue({
        id: 'company-1',
        contacts: [],
      });

      const result = await service.findOne('user-1', 'company-1');

      expect(result).toEqual({
        id: 'company-1',
        contacts: [],
        applicationStats: {
          applied: 0,
          replied: 0,
          ghosted: 0,
          replyRate: 0,
          lastAppliedAt: null,
        },
      });
    });

    it('does not query application stats for a company it cannot find', async () => {
      mockPrisma.company.findFirst.mockResolvedValue(null);

      await expect(service.findOne('user-1', 'company-x')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrisma.job.groupBy).not.toHaveBeenCalled();
    });

    // Phase 6 (docs/specs/company-fk-phase6.md)
    it("includes a lean, newest-first select of the company's jobs", async () => {
      mockPrisma.company.findFirst.mockResolvedValue({
        id: 'company-1',
        contacts: [],
        jobs: [],
      });

      await service.findOne('user-1', 'company-1');

      expect(mockPrisma.company.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            jobs: {
              orderBy: { createdAt: 'desc' },
              select: {
                id: true,
                position: true,
                status: true,
                appliedAt: true,
              },
            },
          }),
        }),
      );
    });
  });

  describe('update', () => {
    it('throws NotFoundException when the company does not belong to the user', async () => {
      mockPrisma.company.findFirst.mockResolvedValue(null);

      await expect(
        service.update('user-1', 'company-x', { name: 'New Name' }),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.company.update).not.toHaveBeenCalled();
    });

    it('passes an explicit null through to clear a previously-set field', async () => {
      mockPrisma.company.findFirst.mockResolvedValue({ id: 'company-1' });
      mockPrisma.company.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.company.findFirstOrThrow.mockResolvedValue({
        id: 'company-1',
        businessMode: null,
      });

      await service.update('user-1', 'company-1', { businessMode: null });

      expect(mockPrisma.company.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'company-1', userId: 'user-1' },
          data: expect.objectContaining({ businessMode: null }),
        }),
      );
    });

    it('throws NotFoundException when the no-rename write races a delete and matches nothing', async () => {
      mockPrisma.company.findFirst.mockResolvedValue({ id: 'company-1' });
      mockPrisma.company.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.update('user-1', 'company-1', { location: 'Remote' }),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.company.findFirstOrThrow).not.toHaveBeenCalled();
    });

    it('throws ConflictException when renaming to a case-insensitive duplicate of another company', async () => {
      mockPrisma.company.findFirst
        .mockResolvedValueOnce({ id: 'company-1' }) // findOwned
        .mockResolvedValueOnce({ id: 'company-2' }); // ensureNameAvailable

      await expect(
        service.update('user-1', 'company-1', { name: 'systems limited' }),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.company.update).not.toHaveBeenCalled();
      expect(mockPrisma.company.findFirst).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: {
            userId: 'user-1',
            name: { equals: 'systems limited', mode: 'insensitive' },
            id: { not: 'company-1' },
          },
        }),
      );
    });

    // The functional unique index on (userId, lower(name)) is what closes the
    // race between the pre-check and the write — no Serializable transaction.
    it('maps a unique-index violation from a racing rename to the same ConflictException, without a transaction', async () => {
      mockPrisma.company.findFirst
        .mockResolvedValueOnce({ id: 'company-1' }) // findOwned
        .mockResolvedValueOnce(null); // ensureNameAvailable passes
      mockPrisma.company.updateMany.mockRejectedValue(
        Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
      );

      await expect(
        service.update('user-1', 'company-1', { name: 'Systems Limited' }),
      ).rejects.toThrow('A company named "Systems Limited" already exists');
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('renames with a user-scoped write and returns the updated company', async () => {
      mockPrisma.company.findFirst
        .mockResolvedValueOnce({ id: 'company-1' })
        .mockResolvedValueOnce(null);
      mockPrisma.company.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.company.findFirstOrThrow.mockResolvedValue({
        id: 'company-1',
        name: 'New Name',
      });

      const result = await service.update('user-1', 'company-1', {
        name: 'New Name',
      });

      expect(mockPrisma.company.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'company-1', userId: 'user-1' },
          data: expect.objectContaining({ name: 'New Name' }),
        }),
      );
      expect(result).toEqual({ id: 'company-1', name: 'New Name' });
    });

    it('does not check for duplicates when name is not being changed', async () => {
      mockPrisma.company.findFirst.mockResolvedValue({ id: 'company-1' });
      mockPrisma.company.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.company.findFirstOrThrow.mockResolvedValue({
        id: 'company-1',
      });

      await service.update('user-1', 'company-1', { location: 'Remote' });

      expect(mockPrisma.company.findFirst).toHaveBeenCalledTimes(1);
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when nothing was deleted', async () => {
      mockPrisma.company.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.remove('user-1', 'company-x')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deletes the company scoped to the user', async () => {
      mockPrisma.company.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.remove('user-1', 'company-1');

      expect(mockPrisma.company.deleteMany).toHaveBeenCalledWith({
        where: { id: 'company-1', userId: 'user-1' },
      });
      expect(result).toEqual({ message: 'Company deleted' });
    });
  });

  describe('triggerEnrichment', () => {
    it('throws NotFoundException when the company does not belong to the user', async () => {
      mockPrisma.company.findFirst.mockResolvedValue(null);

      await expect(
        service.triggerEnrichment('user-1', 'company-x'),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.company.updateMany).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the CAS claim loses the race (already PENDING/PROCESSING)', async () => {
      mockPrisma.company.findFirst.mockResolvedValue({ id: 'company-1' });
      mockPrisma.company.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.triggerEnrichment('user-1', 'company-1'),
      ).rejects.toThrow(ConflictException);
      expect(mockCompanyEnrichment.enqueueEnrichment).not.toHaveBeenCalled();
    });

    it('scopes the CAS claim to the requesting user', async () => {
      mockPrisma.company.findFirst.mockResolvedValue({ id: 'company-1' });
      mockPrisma.company.updateMany.mockResolvedValue({ count: 1 });

      await service.triggerEnrichment('user-1', 'company-1');

      expect(mockPrisma.company.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'company-1',
          userId: 'user-1',
          OR: [
            { status: null },
            {
              status: {
                notIn: [EnrichmentStatus.PENDING, EnrichmentStatus.PROCESSING],
              },
            },
          ],
        },
        data: { status: EnrichmentStatus.PENDING, errorMessage: null },
      });
    });

    it('claims the company and enqueues enrichment when not already busy', async () => {
      mockPrisma.company.findFirst.mockResolvedValue({ id: 'company-1' });
      mockPrisma.company.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.triggerEnrichment('user-1', 'company-1');

      expect(mockCompanyEnrichment.enqueueEnrichment).toHaveBeenCalledWith(
        'company-1',
      );
      expect(result).toEqual({ message: 'Enrichment queued' });
    });
  });
});
