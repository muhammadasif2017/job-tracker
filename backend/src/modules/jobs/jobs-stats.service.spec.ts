import { Test } from '@nestjs/testing';
import { JobStatus } from '@prisma/client';
import { JobsStatsService } from './jobs-stats.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { JobQueryDto } from './dto/job-query.dto.js';
import { computeTrendBuckets } from './jobs.constants.js';

const mockPrisma = {
  job: {
    groupBy: jest.fn(),
    count: jest.fn(),
    findMany: jest.fn(),
  },
  jobEvent: { findMany: jest.fn() },
};

describe('JobsStatsService', () => {
  let service: JobsStatsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        JobsStatsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(JobsStatsService);
  });

  describe('getAttention', () => {
    it('maps each rule to its attention type and dedupes by job', async () => {
      const interviewJob = {
        id: 'job-1',
        nextInterviewAt: new Date('2026-07-17T10:00:00Z'),
      };
      const staleInterviewingJob = {
        id: 'job-2',
        updatedAt: new Date('2026-07-08T00:00:00Z'),
        events: [{ createdAt: new Date('2026-07-09T00:00:00Z') }],
      };
      const staleAppliedJob = {
        id: 'job-3',
        appliedAt: new Date('2026-07-01T00:00:00Z'),
      };
      // job-1 also matches the stale-applied rule — must appear only once
      const duplicateJob = {
        id: 'job-1',
        appliedAt: new Date('2026-07-02T00:00:00Z'),
      };
      mockPrisma.job.findMany
        .mockResolvedValueOnce([interviewJob])
        .mockResolvedValueOnce([staleInterviewingJob])
        .mockResolvedValueOnce([staleAppliedJob, duplicateJob]);

      const items = await service.getAttention('user-1');

      expect(items).toHaveLength(3);
      expect(items[0]).toMatchObject({
        type: 'UPCOMING_INTERVIEW',
        since: interviewJob.nextInterviewAt,
        job: { id: 'job-1' },
      });
      expect(items[1]).toMatchObject({
        type: 'STALE_INTERVIEWING',
        since: staleInterviewingJob.events[0].createdAt,
        job: { id: 'job-2' },
      });
      expect(items[1].job).not.toHaveProperty('events');
      expect(items[2]).toMatchObject({
        type: 'STALE_APPLIED',
        job: { id: 'job-3' },
      });
      // job-1 matched two rules but appears only once, with the higher-priority type
      expect(items.filter((i) => i.job.id === 'job-1')).toHaveLength(1);
    });

    it('returns an empty list when nothing needs attention', async () => {
      mockPrisma.job.findMany.mockResolvedValue([]);

      const items = await service.getAttention('user-1');

      expect(items).toEqual([]);
    });
  });

  describe('getStats', () => {
    it('zero-fills every status when the DB returns no rows', async () => {
      mockPrisma.job.groupBy.mockResolvedValue([]);
      mockPrisma.job.count.mockResolvedValue(0);

      const stats = await service.getStats('u1', 'all');

      expect(stats.total).toBe(0);
      expect(stats.thisMonth).toBe(0);
      expect(stats.responseRate).toBe(0);
      expect(stats.ghostRate).toBe(0);
      for (const s of Object.values(JobStatus)) {
        expect(stats.byStatus[s]).toBe(0);
      }
    });

    it('calculates responseRate correctly from grouped counts', async () => {
      mockPrisma.job.groupBy.mockResolvedValue([
        { status: JobStatus.APPLIED, _count: { _all: 5 } },
        { status: JobStatus.INTERVIEWING, _count: { _all: 3 } },
        { status: JobStatus.OFFER, _count: { _all: 1 } },
        { status: JobStatus.REJECTED, _count: { _all: 1 } },
      ]);
      mockPrisma.job.count.mockResolvedValueOnce(10).mockResolvedValueOnce(4);

      const stats = await service.getStats('u1', 'all');

      expect(stats.responseRate).toBe(50);
      expect(stats.ghostRate).toBe(0);
      expect(stats.total).toBe(10);
      expect(stats.thisMonth).toBe(4);
      expect(stats.byStatus[JobStatus.APPLIED]).toBe(5);
      expect(stats.byStatus[JobStatus.WISHLIST]).toBe(0);
    });

    it('calculates ghostRate correctly from grouped counts', async () => {
      mockPrisma.job.groupBy.mockResolvedValue([
        { status: JobStatus.APPLIED, _count: { _all: 6 } },
        { status: JobStatus.GHOSTED, _count: { _all: 2 } },
        { status: JobStatus.REJECTED, _count: { _all: 2 } },
      ]);
      mockPrisma.job.count.mockResolvedValueOnce(10).mockResolvedValueOnce(0);

      const stats = await service.getStats('u1', 'all');

      expect(stats.ghostRate).toBe(20);
      expect(stats.byStatus[JobStatus.GHOSTED]).toBe(2);
    });

    it('omitting range (all) reproduces output identical to pre-range-filter behavior', async () => {
      mockPrisma.job.groupBy.mockResolvedValue([
        { status: JobStatus.APPLIED, _count: { _all: 5 } },
      ]);
      mockPrisma.job.count.mockResolvedValueOnce(5).mockResolvedValueOnce(2);

      await service.getStats('u1', 'all');

      expect(mockPrisma.job.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u1' } }),
      );
      // thisMonth's count call is untouched by range — still just userId +
      // calendar-month cutoff (plus the WISHLIST exclusion every
      // applications-sent metric carries).
      expect(mockPrisma.job.count).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: { userId: 'u1', status: { not: JobStatus.WISHLIST } },
        }),
      );
    });

    it('excludes WISHLIST from total and thisMonth but not from byStatus', async () => {
      mockPrisma.job.groupBy.mockResolvedValue([
        { status: JobStatus.WISHLIST, _count: { _all: 4 } },
        { status: JobStatus.APPLIED, _count: { _all: 5 } },
        { status: JobStatus.INTERVIEWING, _count: { _all: 5 } },
      ]);
      mockPrisma.job.count.mockResolvedValueOnce(10).mockResolvedValueOnce(3);

      const stats = await service.getStats('u1', 'all');

      // Job.appliedAt is @default(now()), so a wishlist save carries a date
      // and would otherwise inflate the "Total Applications" tile and deflate
      // responseRate. total counts only applications actually sent.
      const [totalCall, thisMonthCall] = mockPrisma.job.count.mock.calls;
      expect(totalCall[0].where).toMatchObject({
        status: { not: JobStatus.WISHLIST },
      });
      expect(thisMonthCall[0].where).toMatchObject({
        status: { not: JobStatus.WISHLIST },
      });
      // 5 INTERVIEWING responded / 10 sent — not / 14 tracked.
      expect(stats.responseRate).toBe(50);
      // The status pie still needs its Wishlist slice.
      expect(mockPrisma.job.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u1' } }),
      );
      expect(stats.byStatus[JobStatus.WISHLIST]).toBe(4);
    });

    it('range=30d adds an appliedAt cutoff to total/byStatus but not to thisMonth', async () => {
      mockPrisma.job.groupBy.mockResolvedValue([]);
      mockPrisma.job.count.mockResolvedValue(0);

      await service.getStats('u1', '30d');

      expect(mockPrisma.job.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1', appliedAt: { gte: expect.any(Date) } },
        }),
      );
      const [totalCall, thisMonthCall] = mockPrisma.job.count.mock.calls;
      expect(totalCall[0]).toEqual({
        where: {
          userId: 'u1',
          appliedAt: { gte: expect.any(Date) },
          status: { not: JobStatus.WISHLIST },
        },
      });
      expect(thisMonthCall[0].where).toEqual({
        userId: 'u1',
        appliedAt: { gte: expect.any(Date) },
        status: { not: JobStatus.WISHLIST },
      });
      // thisMonth's cutoff is the calendar month start, not the 30-day range cutoff.
      const rangeCutoff = totalCall[0].where.appliedAt.gte as Date;
      const monthCutoff = thisMonthCall[0].where.appliedAt.gte as Date;
      expect(monthCutoff.getTime()).not.toBe(rangeCutoff.getTime());
    });
  });

  describe('getFunnel', () => {
    it('returns zero-filled shape when the user has no jobs', async () => {
      mockPrisma.jobEvent.findMany.mockResolvedValue([]);
      mockPrisma.job.groupBy.mockResolvedValue([]);

      const result = await service.getFunnel('u1', 'all');

      expect(result.funnel).toEqual([
        { status: JobStatus.WISHLIST, reached: 0 },
        { status: JobStatus.APPLIED, reached: 0 },
        { status: JobStatus.INTERVIEWING, reached: 0 },
        { status: JobStatus.OFFER, reached: 0 },
      ]);
      expect(result.dropoff).toEqual([
        { status: JobStatus.REJECTED, count: 0 },
        { status: JobStatus.GHOSTED, count: 0 },
      ]);
      expect(result.avgTimeInStageDays).toEqual({});
      expect(result.responseRateBySource).toEqual([]);
    });

    it('computes reached counts, dropoff, closed-interval avg time, and per-source response rate', async () => {
      const day = 86_400_000;
      const t0 = new Date('2026-01-01T00:00:00Z').getTime();
      const at = (ms: number) => new Date(t0 + ms);

      // jA: WISHLIST -> APPLIED (2d) -> INTERVIEWING (3d), still open on INTERVIEWING
      // jB: APPLIED -> REJECTED (4d)
      // jC: APPLIED -> INTERVIEWING (1d) -> OFFER (6d)
      // jD: WISHLIST only, still open
      mockPrisma.jobEvent.findMany.mockResolvedValue([
        { jobId: 'jA', toStatus: JobStatus.WISHLIST, createdAt: at(0) },
        { jobId: 'jA', toStatus: JobStatus.APPLIED, createdAt: at(2 * day) },
        {
          jobId: 'jA',
          toStatus: JobStatus.INTERVIEWING,
          createdAt: at(5 * day),
        },
        { jobId: 'jB', toStatus: JobStatus.APPLIED, createdAt: at(0) },
        { jobId: 'jB', toStatus: JobStatus.REJECTED, createdAt: at(4 * day) },
        { jobId: 'jC', toStatus: JobStatus.APPLIED, createdAt: at(0) },
        {
          jobId: 'jC',
          toStatus: JobStatus.INTERVIEWING,
          createdAt: at(1 * day),
        },
        { jobId: 'jC', toStatus: JobStatus.OFFER, createdAt: at(7 * day) },
        { jobId: 'jD', toStatus: JobStatus.WISHLIST, createdAt: at(0) },
      ]);
      mockPrisma.job.groupBy.mockResolvedValue([
        {
          applicationChannel: 'LINKEDIN',
          status: JobStatus.INTERVIEWING,
          _count: { _all: 1 },
        },
        {
          applicationChannel: 'LINKEDIN',
          status: JobStatus.REJECTED,
          _count: { _all: 1 },
        },
        {
          applicationChannel: 'REFERRAL',
          status: JobStatus.OFFER,
          _count: { _all: 1 },
        },
        {
          applicationChannel: 'CAREER_EMAIL',
          status: JobStatus.APPLIED,
          _count: { _all: 1 },
        },
        {
          applicationChannel: 'ATS',
          status: JobStatus.INTERVIEWING,
          _count: { _all: 1 },
        },
      ]);

      const result = await service.getFunnel('u1', 'all');

      expect(result.funnel).toEqual([
        { status: JobStatus.WISHLIST, reached: 2 }, // jA, jD
        { status: JobStatus.APPLIED, reached: 3 }, // jA, jB, jC
        { status: JobStatus.INTERVIEWING, reached: 2 }, // jA, jC
        { status: JobStatus.OFFER, reached: 1 }, // jC
      ]);

      expect(result.dropoff).toEqual([
        { status: JobStatus.REJECTED, count: 1 },
        { status: JobStatus.GHOSTED, count: 0 },
      ]);

      // jD's open WISHLIST interval is excluded; only jA's closed WISHLIST->APPLIED (2d) counts.
      expect(result.avgTimeInStageDays[JobStatus.WISHLIST]).toBe(2);
      // APPLIED closed intervals: jA=3d, jB=4d, jC=1d -> avg 2.6667 rounded to 2.7
      expect(result.avgTimeInStageDays[JobStatus.APPLIED]).toBe(2.7);
      // jA's open INTERVIEWING interval excluded; only jC's closed INTERVIEWING->OFFER (6d) counts.
      expect(result.avgTimeInStageDays[JobStatus.INTERVIEWING]).toBe(6);
      expect(result.avgTimeInStageDays[JobStatus.OFFER]).toBeUndefined();

      expect(result.responseRateBySource).toEqual(
        expect.arrayContaining([
          { source: 'LINKEDIN', total: 2, responseRate: 100 },
          { source: 'REFERRAL', total: 1, responseRate: 100 },
          { source: 'CAREER_EMAIL', total: 1, responseRate: 0 },
          { source: 'ATS', total: 1, responseRate: 100 },
        ]),
      );
      expect(result.responseRateBySource).toHaveLength(4);
    });

    it('excludes WISHLIST jobs from the responseRateBySource query', async () => {
      mockPrisma.jobEvent.findMany.mockResolvedValue([]);
      mockPrisma.job.groupBy.mockResolvedValue([]);

      await service.getFunnel('u1', 'all');

      expect(mockPrisma.job.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1', status: { not: JobStatus.WISHLIST } },
        }),
      );
    });

    it('keeps dropoff on "ever reached" semantics and excludes non-funnel stages from avgTimeInStageDays, even for a reactivated job', async () => {
      const day = 86_400_000;
      const t0 = new Date('2026-01-01T00:00:00Z').getTime();
      const at = (ms: number) => new Date(t0 + ms);

      // jE: APPLIED -> REJECTED (3d) -> APPLIED (2d later, reactivated), still open
      mockPrisma.jobEvent.findMany.mockResolvedValue([
        { jobId: 'jE', toStatus: JobStatus.APPLIED, createdAt: at(0) },
        { jobId: 'jE', toStatus: JobStatus.REJECTED, createdAt: at(3 * day) },
        { jobId: 'jE', toStatus: JobStatus.APPLIED, createdAt: at(5 * day) },
      ]);
      mockPrisma.job.groupBy.mockResolvedValue([
        {
          applicationChannel: 'OTHER',
          status: JobStatus.APPLIED,
          _count: { _all: 1 },
        },
      ]);

      const result = await service.getFunnel('u1', 'all');

      // Still counted as dropoff even though the job was later reactivated —
      // dropoff and funnel.reached both use "ever reached", not current status.
      expect(result.dropoff).toEqual([
        { status: JobStatus.REJECTED, count: 1 },
        { status: JobStatus.GHOSTED, count: 0 },
      ]);

      // APPLIED -> REJECTED (3d) is a closed interval attributed to APPLIED.
      expect(result.avgTimeInStageDays[JobStatus.APPLIED]).toBe(3);
      // REJECTED -> APPLIED (2d) must NOT leak into avgTimeInStageDays —
      // REJECTED isn't a funnel stage.
      expect(result.avgTimeInStageDays[JobStatus.REJECTED]).toBeUndefined();
    });

    it('omitting range (all) reproduces the pre-range-filter where clauses exactly', async () => {
      mockPrisma.jobEvent.findMany.mockResolvedValue([]);
      mockPrisma.job.groupBy.mockResolvedValue([]);

      await service.getFunnel('u1', 'all');

      expect(mockPrisma.jobEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { job: { userId: 'u1' } } }),
      );
      expect(mockPrisma.job.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1', status: { not: JobStatus.WISHLIST } },
        }),
      );
    });

    it("range=30d filters events and response-rate-by-source by the job's appliedAt", async () => {
      mockPrisma.jobEvent.findMany.mockResolvedValue([]);
      mockPrisma.job.groupBy.mockResolvedValue([]);

      await service.getFunnel('u1', '30d');

      expect(mockPrisma.jobEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            job: { userId: 'u1', appliedAt: { gte: expect.any(Date) } },
          },
        }),
      );
      expect(mockPrisma.job.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: 'u1',
            status: { not: JobStatus.WISHLIST },
            appliedAt: { gte: expect.any(Date) },
          },
        }),
      );
    });
  });

  describe('getTrend', () => {
    it('fetches jobs scoped by range and delegates bucketing to computeTrendBuckets', async () => {
      mockPrisma.job.findMany.mockResolvedValue([
        { appliedAt: new Date('2026-07-01T00:00:00Z') },
      ]);

      const result = await service.getTrend('u1', '30d');

      expect(mockPrisma.job.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'u1',
          appliedAt: { gte: expect.any(Date) },
          status: { not: JobStatus.WISHLIST },
        },
        select: { appliedAt: true },
      });
      expect(result.granularity).toBe('day');
      expect(result.buckets.length).toBeGreaterThan(0);
    });

    it('omitting range (all) fetches with no appliedAt lower bound', async () => {
      mockPrisma.job.findMany.mockResolvedValue([]);

      await service.getTrend('u1', 'all');

      expect(mockPrisma.job.findMany).toHaveBeenCalledWith({
        where: { userId: 'u1', status: { not: JobStatus.WISHLIST } },
        select: { appliedAt: true },
      });
    });

    it('excludes WISHLIST jobs — the chart plots applications sent, not saves', async () => {
      mockPrisma.job.findMany.mockResolvedValue([]);

      await service.getTrend('u1', '30d');

      expect(mockPrisma.job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { not: JobStatus.WISHLIST },
          }),
        }),
      );
    });
  });

  describe('computeTrendBuckets', () => {
    const now = new Date('2026-07-24T12:00:00Z');

    it('range=all with no jobs returns empty buckets, not an error', () => {
      const result = computeTrendBuckets([], 'all', now);
      expect(result).toEqual({ granularity: 'month', buckets: [] });
    });

    it('range=30d/90d with no jobs also returns empty buckets (matches StatusChart/FunnelChart empty-state convention, not an all-zero chart)', () => {
      expect(computeTrendBuckets([], '30d', now)).toEqual({
        granularity: 'day',
        buckets: [],
      });
      expect(computeTrendBuckets([], '90d', now)).toEqual({
        granularity: 'week',
        buckets: [],
      });
    });

    it('range=30d buckets by day and gap-fills days with zero applications', () => {
      const applied = [new Date('2026-07-20T09:00:00Z')];
      const result = computeTrendBuckets(applied, '30d', now);

      expect(result.granularity).toBe('day');
      // 30-day window ending today (inclusive) — every day present, even with count 0.
      expect(result.buckets.length).toBe(31);
      const day20 = result.buckets.find((b) => b.label === 'Jul 20');
      expect(day20?.count).toBe(1);
      const day19 = result.buckets.find((b) => b.label === 'Jul 19');
      expect(day19?.count).toBe(0);
    });

    it('range=90d buckets by week', () => {
      const result = computeTrendBuckets(
        [new Date('2026-07-01T00:00:00Z')],
        '90d',
        now,
      );
      expect(result.granularity).toBe('week');
      expect(result.buckets.length).toBeGreaterThan(0);
    });

    it('range=all buckets by month starting at the earliest appliedAt', () => {
      const applied = [
        new Date('2026-05-15T00:00:00Z'),
        new Date('2026-07-10T00:00:00Z'),
      ];
      const result = computeTrendBuckets(applied, 'all', now);

      expect(result.granularity).toBe('month');
      expect(result.buckets[0].label).toBe('May 2026');
      expect(result.buckets[result.buckets.length - 1].label).toBe('Jul 2026');
    });

    it('cumulative at the last bucket equals the total number of applications', () => {
      const applied = [
        new Date('2026-07-01T00:00:00Z'),
        new Date('2026-07-10T00:00:00Z'),
        new Date('2026-07-15T00:00:00Z'),
      ];
      const result = computeTrendBuckets(applied, '30d', now);
      const last = result.buckets[result.buckets.length - 1];
      expect(last.cumulative).toBe(3);
    });

    it('range=all with a single job in the current month produces exactly one bucket', () => {
      const result = computeTrendBuckets(
        [new Date('2026-07-10T00:00:00Z')],
        'all',
        now,
      );
      expect(result.granularity).toBe('month');
      expect(result.buckets).toHaveLength(1);
      expect(result.buckets[0]).toEqual({
        label: 'Jul 2026',
        periodStart: new Date(2026, 6, 1).toISOString(),
        count: 1,
        cumulative: 1,
      });
    });
  });

  describe('exportCsv', () => {
    it('produces the correct header row', async () => {
      mockPrisma.job.findMany.mockResolvedValue([]);

      const { csv } = await service.exportCsv('u1', new JobQueryDto());

      expect(csv.split('\r\n')[0]).toBe(
        'Company,Position,Status,Discovery Source,Application Channel,Location,Applied Date,Next Interview,URL,Notes',
      );
    });

    it('escapes double-quotes inside field values', async () => {
      mockPrisma.job.findMany.mockResolvedValue([
        {
          company: 'Acme "Corp"',
          position: 'Engineer',
          status: 'APPLIED',
          location: null,
          appliedAt: new Date('2026-01-01'),
          nextInterviewAt: null,
          url: null,
          notes: null,
        },
      ]);

      const { csv } = await service.exportCsv('u1', new JobQueryDto());
      const row = csv.split('\r\n')[1];

      expect(row).toContain('"Acme ""Corp"""');
    });

    it('renders null and undefined fields as empty quoted strings', async () => {
      mockPrisma.job.findMany.mockResolvedValue([
        {
          company: 'Co',
          position: 'P',
          status: 'APPLIED',
          location: null,
          appliedAt: new Date('2026-01-01'),
          nextInterviewAt: null,
          url: null,
          notes: null,
        },
      ]);

      const { csv } = await service.exportCsv('u1', new JobQueryDto());
      const row = csv.split('\r\n')[1];

      expect(row).toContain(',"",');
    });
  });
});
