import { Test } from '@nestjs/testing';
import { JobStatus, JobEventType } from '@prisma/client';
import { JobsStatsService } from './jobs-stats.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { JobQueryDto } from './dto/job-query.dto.js';
import { buildJobWhere, computeTrendBuckets } from './jobs.constants.js';

const mockPrisma = {
  job: {
    groupBy: jest.fn(),
    count: jest.fn(),
    findMany: jest.fn(),
  },
  jobEvent: { findMany: jest.fn() },
  // Every calendar-shaped stat resolves the user's zone first — default it to
  // UTC so assertions below stay independent of the machine running them.
  user: { findUnique: jest.fn() },
};

describe('JobsStatsService', () => {
  let service: JobsStatsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.user.findUnique.mockResolvedValue({ timezone: 'UTC' });
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
        events: [{ createdAt: new Date('2026-07-03T00:00:00Z') }],
      };
      // job-1 also matches the stale-applied rule — must appear only once
      const duplicateJob = {
        id: 'job-1',
        appliedAt: new Date('2026-07-02T00:00:00Z'),
        events: [],
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
        // "stalled since" is the last thing that happened, not the
        // application date — the digest dedup keys off this.
        since: staleAppliedJob.events[0].createdAt,
        job: { id: 'job-3' },
      });
      expect(items[2].job).not.toHaveProperty('events');
      // job-1 matched two rules but appears only once, with the higher-priority type
      expect(items.filter((i) => i.job.id === 'job-1')).toHaveLength(1);
    });

    // "No movement for 7 days" is about activity, not about the application
    // date — a job you followed up on yesterday is not stalled. The appliedAt
    // bound alone was never a movement test; it stays only as a cheap indexed
    // pre-filter and as the guard for a row with no events at all.
    it('scopes STALE_APPLIED by event recency, not by the application date alone', async () => {
      mockPrisma.job.findMany.mockResolvedValue([]);

      await service.getAttention('user-1');

      const staleAppliedCall = mockPrisma.job.findMany.mock.calls[2][0];
      expect(staleAppliedCall.where.events).toEqual({
        none: { createdAt: { gt: expect.any(Date) } },
      });
      expect(staleAppliedCall.include).toEqual({
        events: { orderBy: { createdAt: 'desc' }, take: 1 },
      });
    });

    it('caps each rule bucket so the list stays bounded', async () => {
      // Every row is a fully-hydrated Job and this backs a dashboard
      // call-to-action list, not a report.
      mockPrisma.job.findMany.mockResolvedValue([]);

      await service.getAttention('user-1');

      for (const call of mockPrisma.job.findMany.mock.calls) {
        expect(typeof call[0].take).toBe('number');
        expect(call[0].take).toBeLessThanOrEqual(50);
      }
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
    // User.timezone already drives the digest/reminder emails. Before this,
    // the dashboard's "this month" was cut on the *server's* calendar — a
    // user five hours ahead of a UTC server saw the first evening of a new
    // month counted against the old one.
    it('cuts "this month" on the user calendar, not the server one', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        timezone: 'Asia/Karachi',
      });
      mockPrisma.job.groupBy.mockResolvedValue([]);
      mockPrisma.job.count.mockResolvedValue(0);
      jest.useFakeTimers().setSystemTime(new Date('2026-06-30T20:00:00Z'));

      try {
        await service.getStats('u1', 'all');
      } finally {
        jest.useRealTimers();
      }

      const thisMonthCall = mockPrisma.job.count.mock.calls[1][0];
      // 20:00 UTC on Jun 30 is already July 1st in Karachi, so the boundary
      // is July's. It is a *civil* midnight, not the real instant Karachi's
      // month began — the column it filters holds civil dates (ADR-034), and
      // a bound carrying a time-of-day would half-exclude the 1st.
      expect(thisMonthCall.where.appliedAt.gte.toISOString()).toBe(
        '2026-07-01T00:00:00.000Z',
      );
    });

    it('falls back to UTC when the stored timezone is unusable', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ timezone: 'Not/AZone' });
      mockPrisma.job.groupBy.mockResolvedValue([]);
      mockPrisma.job.count.mockResolvedValue(0);

      await expect(service.getStats('u1', 'all')).resolves.toBeDefined();
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

    it('counts skipped funnel stages as reached when a job is created past APPLIED', async () => {
      // Single CREATED event landing straight on OFFER. Before the rollup
      // this produced OFFER: 1 with APPLIED: 0 — a funnel bar wider at the
      // bottom than the top, and conversion above 100%.
      mockPrisma.jobEvent.findMany.mockResolvedValue([
        {
          jobId: 'jX',
          type: JobEventType.STATUS_CHANGE,
          toStatus: JobStatus.OFFER,
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
      ]);
      mockPrisma.job.groupBy.mockResolvedValue([]);

      const result = await service.getFunnel('u1', 'all');

      expect(result.funnel).toEqual([
        // WISHLIST stays literal — an optional pre-stage, not implied.
        { status: JobStatus.WISHLIST, reached: 0 },
        { status: JobStatus.APPLIED, reached: 1 },
        { status: JobStatus.INTERVIEWING, reached: 1 },
        { status: JobStatus.OFFER, reached: 1 },
      ]);
      // The rollup must not invent events: one event means no closed
      // interval, so no stage has a measurable duration.
      expect(result.avgTimeInStageDays).toEqual({});
    });

    it('counts a kanban APPLIED -> OFFER drag as having reached INTERVIEWING', async () => {
      const day = 86_400_000;
      const t0 = new Date('2026-01-01T00:00:00Z').getTime();
      // The board's columns sit next to each other, so dragging a card two
      // columns right skips INTERVIEWING entirely — the daily-use path into
      // the same bug.
      mockPrisma.jobEvent.findMany.mockResolvedValue([
        {
          jobId: 'jY',
          type: JobEventType.STATUS_CHANGE,
          toStatus: JobStatus.APPLIED,
          createdAt: new Date(t0),
        },
        {
          jobId: 'jY',
          type: JobEventType.STATUS_CHANGE,
          toStatus: JobStatus.OFFER,
          createdAt: new Date(t0 + 3 * day),
        },
      ]);
      mockPrisma.job.groupBy.mockResolvedValue([]);

      const result = await service.getFunnel('u1', 'all');

      expect(result.funnel).toEqual([
        { status: JobStatus.WISHLIST, reached: 0 },
        { status: JobStatus.APPLIED, reached: 1 },
        { status: JobStatus.INTERVIEWING, reached: 1 },
        { status: JobStatus.OFFER, reached: 1 },
      ]);
      // Duration still comes from the two real events — the implied
      // INTERVIEWING stage has no timestamps and so no entry.
      expect(result.avgTimeInStageDays).toEqual({ [JobStatus.APPLIED]: 3 });
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
        {
          jobId: 'jA',
          type: JobEventType.STATUS_CHANGE,
          toStatus: JobStatus.WISHLIST,
          createdAt: at(0),
        },
        {
          jobId: 'jA',
          type: JobEventType.STATUS_CHANGE,
          toStatus: JobStatus.APPLIED,
          createdAt: at(2 * day),
        },
        {
          jobId: 'jA',
          type: JobEventType.STATUS_CHANGE,
          toStatus: JobStatus.INTERVIEWING,
          createdAt: at(5 * day),
        },
        {
          jobId: 'jB',
          type: JobEventType.STATUS_CHANGE,
          toStatus: JobStatus.APPLIED,
          createdAt: at(0),
        },
        {
          jobId: 'jB',
          type: JobEventType.STATUS_CHANGE,
          toStatus: JobStatus.REJECTED,
          createdAt: at(4 * day),
        },
        {
          jobId: 'jC',
          type: JobEventType.STATUS_CHANGE,
          toStatus: JobStatus.APPLIED,
          createdAt: at(0),
        },
        {
          jobId: 'jC',
          type: JobEventType.STATUS_CHANGE,
          toStatus: JobStatus.INTERVIEWING,
          createdAt: at(1 * day),
        },
        {
          jobId: 'jC',
          type: JobEventType.STATUS_CHANGE,
          toStatus: JobStatus.OFFER,
          createdAt: at(7 * day),
        },
        {
          jobId: 'jD',
          type: JobEventType.STATUS_CHANGE,
          toStatus: JobStatus.WISHLIST,
          createdAt: at(0),
        },
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

    // InterviewRoundsService.logRoundEvent writes INTERVIEW_ROUND_ADDED with
    // toStatus set to the job's *current* status. Treating that as a stage
    // boundary chopped one stay in INTERVIEWING into one short interval per
    // round scheduled — so the more rounds a job really had, the faster the
    // stage looked.
    it('does not let INTERVIEW_ROUND_ADDED split a stage into shorter intervals', async () => {
      const day = 86_400_000;
      const t0 = new Date('2026-01-01T00:00:00Z').getTime();
      const at = (ms: number) => new Date(t0 + ms);
      mockPrisma.jobEvent.findMany.mockResolvedValue([
        {
          jobId: 'jR',
          type: JobEventType.STATUS_CHANGE,
          toStatus: JobStatus.INTERVIEWING,
          createdAt: at(0),
        },
        {
          jobId: 'jR',
          type: JobEventType.INTERVIEW_ROUND_ADDED,
          toStatus: JobStatus.INTERVIEWING,
          createdAt: at(2 * day),
        },
        {
          jobId: 'jR',
          type: JobEventType.INTERVIEW_ROUND_ADDED,
          toStatus: JobStatus.INTERVIEWING,
          createdAt: at(5 * day),
        },
        {
          jobId: 'jR',
          type: JobEventType.STATUS_CHANGE,
          toStatus: JobStatus.OFFER,
          createdAt: at(9 * day),
        },
      ]);
      mockPrisma.job.groupBy.mockResolvedValue([]);

      const result = await service.getFunnel('u1', 'all');

      // One 9-day stay, not the mean of 2, 3 and 4.
      expect(result.avgTimeInStageDays[JobStatus.INTERVIEWING]).toBe(9);
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
        {
          jobId: 'jE',
          type: JobEventType.STATUS_CHANGE,
          toStatus: JobStatus.APPLIED,
          createdAt: at(0),
        },
        {
          jobId: 'jE',
          type: JobEventType.STATUS_CHANGE,
          toStatus: JobStatus.REJECTED,
          createdAt: at(3 * day),
        },
        {
          jobId: 'jE',
          type: JobEventType.STATUS_CHANGE,
          toStatus: JobStatus.APPLIED,
          createdAt: at(5 * day),
        },
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

    it('does not re-project a stored civil date into the user zone', () => {
      // `appliedAt` is already a civil date — the user's zone decided which
      // calendar day it names at write time (ADR-034). Resolving it through
      // a zone a second time is what this guards: west of UTC, UTC midnight
      // on Jul 9 reads back as Jul 8 and every bar shifts a day.
      const applied = [new Date('2026-07-09T00:00:00Z')];

      const dayWithTheApplication = (timeZone: string) =>
        computeTrendBuckets(applied, '30d', now, timeZone).buckets.find(
          (b) => b.count === 1,
        )?.label;

      expect(dayWithTheApplication('UTC')).toBe('Jul 9');
      expect(dayWithTheApplication('Asia/Karachi')).toBe('Jul 9');
      expect(dayWithTheApplication('America/New_York')).toBe('Jul 9');
    });

    it('still places the window on the user calendar', () => {
      // The zone is not ignored — it decides which day is "today", and so
      // where the rolling window ends. At 20:00 UTC on Jun 30 a Karachi user
      // is already on Jul 1 and their chart must run one bar further.
      const evening = new Date('2026-06-30T20:00:00Z');
      const applied = [new Date('2026-06-20T00:00:00Z')];

      const lastLabel = (timeZone: string) => {
        const { buckets } = computeTrendBuckets(
          applied,
          '30d',
          evening,
          timeZone,
        );
        return buckets[buckets.length - 1].label;
      };

      expect(lastLabel('UTC')).toBe('Jun 30');
      expect(lastLabel('Asia/Karachi')).toBe('Jul 1');
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
        // Buckets resolve in the caller's zone (UTC by default here), not the
        // server's — so the period start is UTC midnight on the 1st, whatever
        // zone the test machine happens to sit in.
        periodStart: new Date('2026-07-01T00:00:00.000Z').toISOString(),
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

    it('exports Next Interview on the user calendar, not the UTC one', async () => {
      // A real instant, unlike Applied Date — 22:00Z is already the next day
      // in Karachi, and taking its UTC day would export the interview a
      // date early for every user ahead of UTC.
      mockPrisma.user.findUnique.mockResolvedValue({
        timezone: 'Asia/Karachi',
      });
      const future = new Date(Date.now() + 30 * 86_400_000);
      const at22Utc = new Date(
        `${future.toISOString().split('T')[0]}T22:00:00Z`,
      );
      mockPrisma.job.findMany.mockResolvedValue([
        {
          company: 'Co',
          position: 'P',
          status: 'APPLIED',
          location: null,
          appliedAt: new Date('2026-01-01'),
          nextInterviewAt: at22Utc,
          url: null,
          notes: null,
        },
      ]);

      const { csv } = await service.exportCsv('u1', new JobQueryDto());

      const nextDay = new Date(at22Utc.getTime() + 86_400_000)
        .toISOString()
        .split('T')[0];
      expect(csv).toContain(`"${nextDay}"`);
    });

    it('leaves Next Interview blank when the stored date has already passed', async () => {
      mockPrisma.job.findMany.mockResolvedValue([
        {
          company: 'Co',
          position: 'P',
          status: 'APPLIED',
          location: null,
          appliedAt: new Date('2026-01-01'),
          nextInterviewAt: new Date('2020-01-02T00:00:00Z'),
          url: null,
          notes: null,
        },
      ]);

      const { csv } = await service.exportCsv('u1', new JobQueryDto());
      // A stale date must not reach the file at all — the column means
      // "next upcoming interview".
      expect(csv).not.toContain('2020-01-02');
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
  describe('buildJobWhere', () => {
    const query = (overrides: Partial<JobQueryDto>) =>
      Object.assign(new JobQueryDto(), overrides);

    it('lets statusIn win over status instead of one silently dropping the other', () => {
      // Both write the same `status` key — spreading them separately would
      // make whichever came first vanish.
      const where = buildJobWhere(
        'u1',
        query({
          status: JobStatus.APPLIED,
          statusIn: [JobStatus.WISHLIST, JobStatus.OFFER],
        }),
      );

      expect(where.status).toEqual({
        in: [JobStatus.WISHLIST, JobStatus.OFFER],
      });
    });

    it('falls back to status when statusIn is absent or empty', () => {
      expect(
        buildJobWhere('u1', query({ status: JobStatus.APPLIED })).status,
      ).toBe(JobStatus.APPLIED);
      expect(
        buildJobWhere('u1', query({ status: JobStatus.APPLIED, statusIn: [] }))
          .status,
      ).toBe(JobStatus.APPLIED);
    });

    it('covers the whole day named by a date-only dateTo', () => {
      // `lte: new Date('2026-03-15')` is that day's midnight, which excludes
      // everything actually applied during the day.
      const where = buildJobWhere('u1', query({ dateTo: '2026-03-15' }));

      expect(where.appliedAt).toEqual({ lt: new Date('2026-03-16T00:00:00Z') });
    });

    it('treats a full ISO dateTo as the exact instant it names', () => {
      const where = buildJobWhere(
        'u1',
        query({ dateTo: '2026-03-15T12:00:00.000Z' }),
      );

      expect(where.appliedAt).toEqual({
        lte: new Date('2026-03-15T12:00:00.000Z'),
      });
    });

    it('searches location and notes alongside company and position', () => {
      const where = buildJobWhere('u1', query({ search: 'remote' }));

      expect(where.OR?.map((clause) => Object.keys(clause)[0])).toEqual([
        'company',
        'position',
        'location',
        'notes',
      ]);
    });
  });
});
