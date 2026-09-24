import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { CompanyDedupService } from './company-dedup.service.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';

const mockPrisma = {
  company: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  job: { updateMany: jest.fn() },
  contact: { updateMany: jest.fn() },
  // Mirrors Prisma's interactive-transaction shape closely enough for unit
  // tests: hands the callback the same mock client, ignoring isolationLevel.
  $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(mockPrisma)),
};

describe('CompanyDedupService', () => {
  let service: CompanyDedupService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        CompanyDedupService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(CompanyDedupService);
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
        where: { companyId: 'duplicate-1', userId: 'user-1' },
        data: { companyId: 'canonical-1' },
      });
      expect(mockPrisma.contact.updateMany).toHaveBeenCalledWith({
        where: { companyId: 'duplicate-1', company: { userId: 'user-1' } },
        data: { companyId: 'canonical-1' },
      });
      expect(mockPrisma.company.delete).toHaveBeenCalledWith({
        where: { id: 'duplicate-1' },
      });
      expect(result).toEqual({ id: 'canonical-1', name: 'Canonical Co' });
    });

    it('runs inside a Serializable transaction', async () => {
      mockPrisma.company.findFirst
        .mockResolvedValueOnce({ id: 'canonical-1', name: 'Canonical Co' })
        .mockResolvedValueOnce({ id: 'duplicate-1', name: 'Duplicate Co' });
      mockPrisma.job.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.contact.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.company.delete.mockResolvedValue({ id: 'duplicate-1' });

      await service.mergeCompanies('user-1', 'canonical-1', 'duplicate-1');

      expect(mockPrisma.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ isolationLevel: 'Serializable' }),
      );
    });

    it('throws ConflictException when a concurrent merge of the same duplicate is detected (P2034)', async () => {
      mockPrisma.$transaction.mockRejectedValueOnce({ code: 'P2034' });

      await expect(
        service.mergeCompanies('user-1', 'canonical-1', 'duplicate-1'),
      ).rejects.toThrow(ConflictException);
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

    // Guards the length pre-filter: 20 vs 17 chars is distance 3, ratio
    // exactly 0.85 — the skip must not drop a pair sitting on the threshold.
    it('still flags a name match whose length gap sits exactly on the threshold', async () => {
      mockPrisma.company.findMany.mockResolvedValue([
        { id: 'c-1', name: 'abcdefghijklmnopqrst', websiteUrl: null },
        { id: 'c-2', name: 'abcdefghijklmnopq', websiteUrl: null },
      ]);

      const result = await service.findDuplicateSuggestions('user-1');

      expect(result).toHaveLength(1);
      expect(result[0].reason).toBe('name');
    });

    it('does not flag names whose length gap alone rules out a match', async () => {
      mockPrisma.company.findMany.mockResolvedValue([
        { id: 'c-1', name: 'abcdefghijklmnopqrst', websiteUrl: null },
        { id: 'c-2', name: 'abcdefghijklmnop', websiteUrl: null },
      ]);

      const result = await service.findDuplicateSuggestions('user-1');

      expect(result).toEqual([]);
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
