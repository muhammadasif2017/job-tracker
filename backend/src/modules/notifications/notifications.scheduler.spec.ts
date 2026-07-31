import { DigestFrequency } from '@prisma/client';
import { NotificationsScheduler } from './notifications.scheduler.js';

describe('NotificationsScheduler', () => {
  const logger = { log: jest.fn(), warn: jest.fn() };
  const queue = { add: jest.fn().mockResolvedValue(undefined) };

  afterEach(() => jest.clearAllMocks());

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
      expect(queue.add).toHaveBeenCalledWith('interview-reminder', {
        roundId: 'round1',
      });
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
    it('enqueues a digest only for users with non-empty attention items', async () => {
      const prisma = {
        user: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]),
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
        select: { id: true },
      });
      expect(queue.add).toHaveBeenCalledTimes(1);
      expect(queue.add).toHaveBeenCalledWith('digest', { userId: 'u1' });
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
        select: { id: true },
      });
      expect(queue.add).not.toHaveBeenCalled();
    });
  });
});
