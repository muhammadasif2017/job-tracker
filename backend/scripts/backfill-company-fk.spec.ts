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

    it('is idempotent: a second run against the post-first-run DB state finds no candidates and writes nothing', async () => {
      // Idempotency rests entirely on `job.findMany`'s `where: { companyId:
      // null }` filter excluding rows the first run already linked — this
      // pins that down instead of only relying on reading the source. Not a
      // literal two-call harness (the mock has no real persistence between
      // calls), but simulates it: the "second run" query reflects the
      // post-apply DB state a real Postgres would return.
      const prisma = makeMockPrisma();
      prisma.job.findMany.mockResolvedValueOnce([
        { id: 'job-1', userId: 'user-1', company: 'Systems Limited' },
      ]);
      prisma.company.findFirst.mockResolvedValue({ id: 'company-1' });

      const firstRun = await runBackfill(prisma, true, noop, noop);
      expect(firstRun.matchedExisting).toBe(1);
      expect(prisma.job.update).toHaveBeenCalledTimes(1);

      prisma.job.update.mockClear();
      prisma.company.findFirst.mockClear();
      // job-1 no longer appears — a real Postgres query for
      // `companyId: null` would exclude it after the first run's update.
      prisma.job.findMany.mockResolvedValueOnce([]);

      const secondRun = await runBackfill(prisma, true, noop, noop);

      expect(secondRun).toEqual({
        totalCandidates: 0,
        blank: 0,
        matchedExisting: 0,
        createdNew: 0,
        unmatched: [],
      });
      expect(prisma.company.findFirst).not.toHaveBeenCalled();
      expect(prisma.job.update).not.toHaveBeenCalled();
    });

    it('stops immediately on a mid-loop job.update failure, leaving earlier rows in this run already applied and later rows untouched', async () => {
      // Pins down current behavior: the per-row loop has no try/catch around
      // `job.update`, so a failure on any row after the first aborts the
      // whole run — rows before it keep their (already-committed) update,
      // rows after it are never attempted, and no summary is logged. This is
      // intentional-by-omission today, not verified safe; this test exists
      // so a future change to that behavior is a deliberate, visible diff
      // here rather than a silent regression.
      const prisma = makeMockPrisma();
      prisma.job.findMany.mockResolvedValue([
        { id: 'job-1', userId: 'user-1', company: 'First Co' },
        { id: 'job-2', userId: 'user-1', company: 'Second Co' },
        { id: 'job-3', userId: 'user-1', company: 'Third Co' },
      ]);
      prisma.company.findFirst.mockResolvedValue({ id: 'company-match' });
      prisma.job.update
        .mockResolvedValueOnce(undefined) // job-1 succeeds
        .mockRejectedValueOnce(new Error('DB connection lost')); // job-2 fails

      await expect(runBackfill(prisma, true, noop, noop)).rejects.toThrow(
        'DB connection lost',
      );

      expect(prisma.job.update).toHaveBeenCalledTimes(2);
      expect(prisma.job.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'job-1' },
        data: { companyId: 'company-match' },
      });
      expect(prisma.job.update).toHaveBeenNthCalledWith(2, {
        where: { id: 'job-2' },
        data: { companyId: 'company-match' },
      });
      // job-3 never reached — the throw on job-2 aborted the loop.
    });
  });
});
