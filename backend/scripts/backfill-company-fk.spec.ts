import { CompanyCity } from '@prisma/client';
import { runBackfill } from './backfill-company-fk.core.js';

function makeMockPrisma() {
  return {
    job: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
    company: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  };
}

const noop = () => {};

describe('runBackfill', () => {
  it('skips blank-company-name jobs entirely (no lookup, no write)', async () => {
    const prisma = makeMockPrisma();
    prisma.job.findMany.mockResolvedValue([
      { id: 'job-1', userId: 'user-1', company: '   ' },
    ]);

    const summary = await runBackfill(prisma, false, noop, noop);

    expect(summary).toEqual({
      totalCandidates: 1,
      blank: 1,
      matchedExisting: 0,
      createdNew: 0,
      unmatched: [],
    });
    expect(prisma.company.findFirst).not.toHaveBeenCalled();
  });

  describe('dry run', () => {
    it('counts a case-insensitive match against an existing company without writing', async () => {
      const prisma = makeMockPrisma();
      prisma.job.findMany.mockResolvedValue([
        { id: 'job-1', userId: 'user-1', company: 'systems limited' },
      ]);
      prisma.company.findFirst.mockResolvedValue({ id: 'company-1' });

      const summary = await runBackfill(prisma, false, noop, noop);

      expect(summary.matchedExisting).toBe(1);
      expect(summary.createdNew).toBe(0);
      expect(prisma.company.create).not.toHaveBeenCalled();
      expect(prisma.job.update).not.toHaveBeenCalled();
    });

    it('dedupes repeated new company names within the same dry-run batch instead of double-counting createdNew', async () => {
      const prisma = makeMockPrisma();
      prisma.job.findMany.mockResolvedValue([
        { id: 'job-1', userId: 'user-1', company: 'Brand New Co' },
        { id: 'job-2', userId: 'user-1', company: 'brand new co' }, // same company, different case
      ]);
      prisma.company.findFirst.mockResolvedValue(null);

      const summary = await runBackfill(prisma, false, noop, noop);

      expect(summary.createdNew).toBe(1);
      expect(summary.matchedExisting).toBe(1); // the second job matches the first's pending placeholder
      expect(prisma.job.update).not.toHaveBeenCalled();
    });

    it('does not dedupe the same new company name across different users', async () => {
      const prisma = makeMockPrisma();
      prisma.job.findMany.mockResolvedValue([
        { id: 'job-1', userId: 'user-1', company: 'Acme' },
        { id: 'job-2', userId: 'user-2', company: 'Acme' },
      ]);
      prisma.company.findFirst.mockResolvedValue(null);

      const summary = await runBackfill(prisma, false, noop, noop);

      expect(summary.createdNew).toBe(2);
      expect(summary.matchedExisting).toBe(0);
    });
  });

  describe('apply mode', () => {
    it('creates a new Company (city OTHER) and links companyId when no match exists', async () => {
      const prisma = makeMockPrisma();
      prisma.job.findMany.mockResolvedValue([
        { id: 'job-1', userId: 'user-1', company: 'Brand New Co' },
      ]);
      prisma.company.findFirst.mockResolvedValue(null);
      prisma.company.create.mockResolvedValue({ id: 'company-new' });

      const summary = await runBackfill(prisma, true, noop, noop);

      expect(prisma.company.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          name: 'Brand New Co',
          city: CompanyCity.OTHER,
        },
        select: { id: true },
      });
      expect(prisma.job.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: { companyId: 'company-new' },
      });
      expect(summary.createdNew).toBe(1);
    });

    it('links companyId to a matching existing company without creating a new one', async () => {
      const prisma = makeMockPrisma();
      prisma.job.findMany.mockResolvedValue([
        { id: 'job-1', userId: 'user-1', company: 'Systems Limited' },
      ]);
      prisma.company.findFirst.mockResolvedValue({ id: 'company-1' });

      const summary = await runBackfill(prisma, true, noop, noop);

      expect(prisma.company.create).not.toHaveBeenCalled();
      expect(prisma.job.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: { companyId: 'company-1' },
      });
      expect(summary.matchedExisting).toBe(1);
    });

    it('re-fetches instead of failing the row when a concurrent run creates the same company first (unique-constraint race)', async () => {
      const prisma = makeMockPrisma();
      prisma.job.findMany.mockResolvedValue([
        { id: 'job-1', userId: 'user-1', company: 'Race Co' },
      ]);
      prisma.company.findFirst
        .mockResolvedValueOnce(null) // initial lookup: no match yet
        .mockResolvedValueOnce({ id: 'company-raced' }); // re-fetch after the create races
      prisma.company.create.mockRejectedValue(
        Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
      );

      const summary = await runBackfill(prisma, true, noop, noop);

      expect(prisma.company.findFirst).toHaveBeenCalledTimes(2);
      expect(prisma.job.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: { companyId: 'company-raced' },
      });
      expect(summary.matchedExisting).toBe(1);
      expect(summary.unmatched).toEqual([]);
    });

    it('records the job as unmatched and does not write when both create and the raced re-fetch fail', async () => {
      const prisma = makeMockPrisma();
      prisma.job.findMany.mockResolvedValue([
        { id: 'job-1', userId: 'user-1', company: 'Doomed Co' },
      ]);
      prisma.company.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null); // still no match after the race
      prisma.company.create.mockRejectedValue(
        Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
      );

      const summary = await runBackfill(prisma, true, noop, noop);

      expect(prisma.job.update).not.toHaveBeenCalled();
      expect(summary.unmatched).toEqual(['job-1']);
      expect(summary.matchedExisting).toBe(0);
      expect(summary.createdNew).toBe(0);
    });
  });
});
