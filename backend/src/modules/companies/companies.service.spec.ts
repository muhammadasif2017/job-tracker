import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { EnrichmentStatus } from '@prisma/client';
import { CompaniesService } from './companies.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CompanyEnrichmentService } from './enrichment/company-enrichment.service.js';
import { Logger } from 'nestjs-pino';

const mockPrisma = {
  company: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
    delete: jest.fn(),
  },
  job: { updateMany: jest.fn() },
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

      expect(result).toEqual({ id: 'company-1', contacts: [] });
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
                priority: true,
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
      mockPrisma.company.update.mockResolvedValue({
        id: 'company-1',
        businessMode: null,
      });

      await service.update('user-1', 'company-1', { businessMode: null });

      expect(mockPrisma.company.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'company-1' },
          data: expect.objectContaining({ businessMode: null }),
        }),
      );
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

    it('does not check for duplicates when name is not being changed', async () => {
      mockPrisma.company.findFirst.mockResolvedValue({ id: 'company-1' });
      mockPrisma.company.update.mockResolvedValue({ id: 'company-1' });

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

  describe('mergeCompanies', () => {
    it('reassigns jobs and contacts, deletes the duplicate, and returns the canonical company', async () => {
      mockPrisma.company.findFirst
        .mockResolvedValueOnce({ id: 'canonical-1', name: 'Canonical Co' })
        .mockResolvedValueOnce({ id: 'duplicate-1', name: 'Duplicate Co' });
      mockPrisma.job.updateMany.mockResolvedValue({ count: 2 });
      mockPrisma.contact.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.company.delete.mockResolvedValue({ id: 'duplicate-1' });

      const result = await service.mergeCompanies(
        'user-1',
        'canonical-1',
        'duplicate-1',
      );

      expect(mockPrisma.job.updateMany).toHaveBeenCalledWith({
        where: { companyId: 'duplicate-1' },
        data: { companyId: 'canonical-1' },
      });
      expect(mockPrisma.contact.updateMany).toHaveBeenCalledWith({
        where: { companyId: 'duplicate-1' },
        data: { companyId: 'canonical-1' },
      });
      expect(mockPrisma.company.delete).toHaveBeenCalledWith({
        where: { id: 'duplicate-1' },
      });
      expect(result).toEqual({ id: 'canonical-1', name: 'Canonical Co' });
    });

    it('throws ConflictException when merging a company with itself, without touching the DB', async () => {
      await expect(
        service.mergeCompanies('user-1', 'company-1', 'company-1'),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.company.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.job.updateMany).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the canonical company does not belong to the user', async () => {
      mockPrisma.company.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'duplicate-1', name: 'Duplicate Co' });

      await expect(
        service.mergeCompanies('user-1', 'canonical-1', 'duplicate-1'),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.job.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.company.delete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the duplicate company does not belong to the user (cross-user merge rejected)', async () => {
      mockPrisma.company.findFirst
        .mockResolvedValueOnce({ id: 'canonical-1', name: 'Canonical Co' })
        .mockResolvedValueOnce(null);

      await expect(
        service.mergeCompanies('user-1', 'canonical-1', 'duplicate-1'),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.job.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.company.delete).not.toHaveBeenCalled();
    });

    it('succeeds when the duplicate has zero jobs and zero contacts (no-op reassignment)', async () => {
      mockPrisma.company.findFirst
        .mockResolvedValueOnce({ id: 'canonical-1', name: 'Canonical Co' })
        .mockResolvedValueOnce({ id: 'duplicate-1', name: 'Duplicate Co' });
      mockPrisma.job.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.contact.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.company.delete.mockResolvedValue({ id: 'duplicate-1' });

      await expect(
        service.mergeCompanies('user-1', 'canonical-1', 'duplicate-1'),
      ).resolves.toEqual({ id: 'canonical-1', name: 'Canonical Co' });
      expect(mockPrisma.company.delete).toHaveBeenCalled();
    });

    it('applies fieldOverrides to the canonical company as part of the merge', async () => {
      mockPrisma.company.findFirst
        .mockResolvedValueOnce({
          id: 'canonical-1',
          name: 'Canonical Co',
          industry: 'Old industry',
        })
        .mockResolvedValueOnce({ id: 'duplicate-1', name: 'Duplicate Co' });
      mockPrisma.job.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.contact.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.company.delete.mockResolvedValue({ id: 'duplicate-1' });
      mockPrisma.company.update.mockResolvedValue({
        id: 'canonical-1',
        name: 'Canonical Co',
        industry: 'New industry from duplicate',
      });

      const result = await service.mergeCompanies(
        'user-1',
        'canonical-1',
        'duplicate-1',
        { industry: 'New industry from duplicate' },
      );

      expect(mockPrisma.company.update).toHaveBeenCalledWith({
        where: { id: 'canonical-1' },
        data: { industry: 'New industry from duplicate' },
      });
      expect(result).toEqual({
        id: 'canonical-1',
        name: 'Canonical Co',
        industry: 'New industry from duplicate',
      });
    });

    it('does not call update when fieldOverrides is an empty object', async () => {
      mockPrisma.company.findFirst
        .mockResolvedValueOnce({ id: 'canonical-1', name: 'Canonical Co' })
        .mockResolvedValueOnce({ id: 'duplicate-1', name: 'Duplicate Co' });
      mockPrisma.job.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.contact.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.company.delete.mockResolvedValue({ id: 'duplicate-1' });

      await service.mergeCompanies('user-1', 'canonical-1', 'duplicate-1', {});

      expect(mockPrisma.company.update).not.toHaveBeenCalled();
    });
  });

  describe('findDuplicateSuggestions', () => {
    it('flags a pair with matching websiteUrl (different casing/protocol) as a website match', async () => {
      mockPrisma.company.findMany.mockResolvedValue([
        { id: 'c-1', name: 'Acme Inc', websiteUrl: 'https://www.acme.com/' },
        { id: 'c-2', name: 'Acme Corporation', websiteUrl: 'ACME.com' },
      ]);

      const result = await service.findDuplicateSuggestions('user-1');

      expect(result).toEqual([
        {
          companyA: {
            id: 'c-1',
            name: 'Acme Inc',
            websiteUrl: 'https://www.acme.com/',
          },
          companyB: {
            id: 'c-2',
            name: 'Acme Corporation',
            websiteUrl: 'ACME.com',
          },
          reason: 'website',
        },
      ]);
    });

    it('flags a pair with a fuzzy name match when websiteUrl does not match', async () => {
      mockPrisma.company.findMany.mockResolvedValue([
        { id: 'c-1', name: 'Systems Limited', websiteUrl: null },
        { id: 'c-2', name: 'systems ltd.', websiteUrl: null },
      ]);

      const result = await service.findDuplicateSuggestions('user-1');

      expect(result).toHaveLength(1);
      expect(result[0].reason).toBe('name');
    });

    it('prefers a website match over a name match when both would fire', async () => {
      mockPrisma.company.findMany.mockResolvedValue([
        {
          id: 'c-1',
          name: 'Systems Limited',
          websiteUrl: 'https://systems.com',
        },
        {
          id: 'c-2',
          name: 'Systems Limited',
          websiteUrl: 'https://systems.com',
        },
      ]);

      const result = await service.findDuplicateSuggestions('user-1');

      expect(result).toHaveLength(1);
      expect(result[0].reason).toBe('website');
    });

    it('does not flag unrelated companies', async () => {
      mockPrisma.company.findMany.mockResolvedValue([
        { id: 'c-1', name: 'Systems Limited', websiteUrl: null },
        { id: 'c-2', name: 'Totally Different Co', websiteUrl: null },
      ]);

      const result = await service.findDuplicateSuggestions('user-1');

      expect(result).toEqual([]);
    });

    it('only compares companies within the scoping userId query', async () => {
      mockPrisma.company.findMany.mockResolvedValue([]);

      await service.findDuplicateSuggestions('user-1');

      expect(mockPrisma.company.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1' } }),
      );
    });
  });
});
