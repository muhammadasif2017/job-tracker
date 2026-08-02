import { DigestFrequency } from '@prisma/client';
import { NotificationsScheduler } from './notifications.scheduler.js';

describe('NotificationsScheduler', () => {
  const logger = { log: jest.fn(), warn: jest.fn() };
  const queue = { add: jest.fn().mockResolvedValue(undefined) };

  // 08:00 UTC on a Monday — matches DIGEST_SEND_HOUR for a UTC user and
  // satisfies the weekly local-Monday check, so digest fan-out tests don't
  // depend on the real wall clock.
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-03T08:00:00Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('scanInterviewReminders', () => {
    it('enqueues a reminder and stamps reminderSentAt for an eligible round', async () => {
      const prisma = {
        interviewRound: {
          findMany: jest.fn().mockResolvedValue([{ id: 'round1' }]),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      };
      const scheduler = new NotificationsScheduler(
        queue as any,
        prisma as any,
        logger as any,
      );

      await scheduler.scanInterviewReminders();

      expect(prisma.interviewRound.updateMany).toHaveBeenCalledWith({
        where: { id: 'round1', reminderSentAt: null },
        data: { reminderSentAt: expect.any(Date) },
      });
      expect(queue.add).toHaveBeenCalledWith(
        'interview-reminder',
        { roundId: 'round1' },
        expect.objectContaining({ attempts: 2 }),
      );
    });

    it('skips enqueueing when the round was already claimed (dedup race)', async () => {
      const prisma = {
        interviewRound: {
          findMany: jest.fn().mockResolvedValue([{ id: 'round1' }]),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      };
      const scheduler = new NotificationsScheduler(
        queue as any,
        prisma as any,
        logger as any,
      );

      await scheduler.scanInterviewReminders();

      expect(queue.add).not.toHaveBeenCalled();
    });

    it('does nothing when no rounds are eligible', async () => {
      const prisma = {
        interviewRound: {
          findMany: jest.fn().mockResolvedValue([]),
          updateMany: jest.fn(),
        },
      };
      const scheduler = new NotificationsScheduler(
        queue as any,
        prisma as any,
        logger as any,
      );

      await scheduler.scanInterviewReminders();

      expect(prisma.interviewRound.updateMany).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('rerunning the same scan does not enqueue twice for an already-stamped round', async () => {
      const prisma = {
        interviewRound: {
          // Second run: the where clause (reminderSentAt: null) would already
          // exclude this round, so findMany returns nothing.
          findMany: jest.fn().mockResolvedValueOnce([]),
          updateMany: jest.fn(),
        },
      };
      const scheduler = new NotificationsScheduler(
        queue as any,
        prisma as any,
        logger as any,
      );

      await scheduler.scanInterviewReminders();

      expect(queue.add).not.toHaveBeenCalled();
    });
  });

  describe('digest fan-out', () => {
    it('enqueues a digest only for users with non-empty attention items, at their local send hour', async () => {
      const prisma = {
        user: {
          findMany: jest
            .fn()
            .mockResolvedValue([
              { id: 'u1', timezone: 'UTC' },
              { id: 'u2', timezone: 'UTC' },
            ]),
        },
        job: {
          findMany: jest
            .fn()
            .mockResolvedValueOnce([
              {
                id: 'j1',
                company: 'Acme',
                position: 'Eng',
                nextInterviewAt: new Date(),
              },
            ])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([]),
        },
      };
      const scheduler = new NotificationsScheduler(
        queue as any,
        prisma as any,
        logger as any,
      );

      await scheduler.sendDailyDigests();

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { digestFrequency: DigestFrequency.DAILY },
        select: { id: true, timezone: true },
      });
      expect(queue.add).toHaveBeenCalledTimes(1);
      expect(queue.add).toHaveBeenCalledWith(
        'digest',
        { userId: 'u1' },
        expect.objectContaining({
          attempts: 2,
          jobId: 'digest-DAILY-u1-2026-08-03',
        }),
      );
    });

    it('enqueues digests for two different users with distinct jobIds', async () => {
      const upcomingJob = {
        id: 'j1',
        company: 'Acme',
        position: 'Eng',
        nextInterviewAt: new Date(),
      };
      // getAttentionItems does 3 findMany calls per user (upcoming, stale
      // interviewing, stale applied) — only the first is non-empty here.
      const perUserResponses = () => [
        Promise.resolve([upcomingJob]),
        Promise.resolve([]),
        Promise.resolve([]),
      ];
      const responses = [...perUserResponses(), ...perUserResponses()];
      const prisma = {
        user: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'u1', timezone: 'UTC' },
            { id: 'u2', timezone: 'UTC' },
          ]),
        },
        job: {
          findMany: jest.fn(() => responses.shift()),
        },
      };
      const scheduler = new NotificationsScheduler(
        queue as any,
        prisma as any,
        logger as any,
      );

      await scheduler.sendDailyDigests();

      expect(queue.add).toHaveBeenCalledTimes(2);
      const jobIds = queue.add.mock.calls.map((call: any[]) => call[2].jobId);
      expect(new Set(jobIds).size).toBe(2);
    });

    it('enqueues nothing when no users match the frequency', async () => {
      const prisma = {
        user: { findMany: jest.fn().mockResolvedValue([]) },
        job: { findMany: jest.fn() },
      };
      const scheduler = new NotificationsScheduler(
        queue as any,
        prisma as any,
        logger as any,
      );

      await scheduler.sendWeeklyDigests();

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { digestFrequency: DigestFrequency.WEEKLY },
        select: { id: true, timezone: true },
      });
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('skips a user whose local hour is not the digest send hour', async () => {
      // System time is 08:00 UTC. Asia/Karachi (UTC+5) is 13:00 local —
      // this run must not fire for them; a later hourly tick will.
      const prisma = {
        user: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ id: 'u1', timezone: 'Asia/Karachi' }]),
        },
        job: { findMany: jest.fn() },
      };
      const scheduler = new NotificationsScheduler(
        queue as any,
        prisma as any,
        logger as any,
      );

      await scheduler.sendDailyDigests();

      expect(queue.add).not.toHaveBeenCalled();
    });

    it('fires for a non-UTC user once the scan lands on their local send hour', async () => {
      // 03:00 UTC = 08:00 in Asia/Karachi (UTC+5).
      jest.setSystemTime(new Date('2026-08-03T03:00:00Z'));
      const prisma = {
        user: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ id: 'u1', timezone: 'Asia/Karachi' }]),
        },
        job: {
          findMany: jest
            .fn()
            .mockResolvedValueOnce([
              {
                id: 'j1',
                company: 'Acme',
                position: 'Eng',
                nextInterviewAt: new Date(),
              },
            ])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([]),
        },
      };
      const scheduler = new NotificationsScheduler(
        queue as any,
        prisma as any,
        logger as any,
      );

      await scheduler.sendDailyDigests();

      expect(queue.add).toHaveBeenCalledWith(
        'digest',
        { userId: 'u1' },
        expect.objectContaining({ jobId: 'digest-DAILY-u1-2026-08-03' }),
      );
    });

    it('only fires the weekly digest on the user\'s local Monday, even at their local send hour', async () => {
      // 08:00 UTC on Tuesday Aug 4 — right hour, wrong weekday.
      jest.setSystemTime(new Date('2026-08-04T08:00:00Z'));
      const prisma = {
        user: {
          findMany: jest.fn().mockResolvedValue([{ id: 'u1', timezone: 'UTC' }]),
        },
        job: { findMany: jest.fn() },
      };
      const scheduler = new NotificationsScheduler(
        queue as any,
        prisma as any,
        logger as any,
      );

      await scheduler.sendWeeklyDigests();

      expect(queue.add).not.toHaveBeenCalled();
    });

    it('fires the weekly digest on the user\'s local Monday at their local send hour', async () => {
      // beforeEach system time is 08:00 UTC on Monday Aug 3 — right hour and weekday for a UTC user.
      const prisma = {
        user: {
          findMany: jest.fn().mockResolvedValue([{ id: 'u1', timezone: 'UTC' }]),
        },
        job: {
          findMany: jest
            .fn()
            .mockResolvedValueOnce([
              {
                id: 'j1',
                company: 'Acme',
                position: 'Eng',
                nextInterviewAt: new Date(),
              },
            ])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([]),
        },
      };
      const scheduler = new NotificationsScheduler(
        queue as any,
        prisma as any,
        logger as any,
      );

      await scheduler.sendWeeklyDigests();

      expect(queue.add).toHaveBeenCalledWith(
        'digest',
        { userId: 'u1' },
        expect.objectContaining({ jobId: 'digest-WEEKLY-u1-2026-08-03' }),
      );
    });

    it('a malformed timezone on one user does not block the digest for other users in the same tick', async () => {
      const prisma = {
        user: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'bad-user', timezone: 'Not/A_Real_Zone' },
            { id: 'u2', timezone: 'UTC' },
          ]),
        },
        job: {
          findMany: jest
            .fn()
            .mockResolvedValueOnce([
              {
                id: 'j1',
                company: 'Acme',
                position: 'Eng',
                nextInterviewAt: new Date(),
              },
            ])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([]),
        },
      };
      const scheduler = new NotificationsScheduler(
        queue as any,
        prisma as any,
        logger as any,
      );

      await scheduler.sendDailyDigests();

      expect(logger.warn).toHaveBeenCalledWith(
        'digest_invalid_timezone',
        expect.objectContaining({ userId: 'bad-user' }),
      );
      expect(queue.add).toHaveBeenCalledTimes(1);
      expect(queue.add).toHaveBeenCalledWith(
        'digest',
        { userId: 'u2' },
        expect.objectContaining({ jobId: 'digest-DAILY-u2-2026-08-03' }),
      );
    });
  });
});
