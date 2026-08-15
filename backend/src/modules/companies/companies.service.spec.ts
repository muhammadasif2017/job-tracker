import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
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
  },
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

      expect(mockPrisma.company.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'company-1',
            userId: 'user-1',
          }),
        }),
      );
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
