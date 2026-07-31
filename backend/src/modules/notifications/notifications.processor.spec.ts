import { DigestFrequency } from '@prisma/client';
import { NotificationsProcessor } from './notifications.processor.js';

describe('NotificationsProcessor', () => {
  const email = { send: jest.fn().mockResolvedValue(undefined) };
  const logger = { log: jest.fn(), warn: jest.fn() };
  const config = { get: jest.fn().mockReturnValue('http://localhost:3000') };

  afterEach(() => jest.clearAllMocks());

  describe('interview-reminder', () => {
    it('sends when the user has reminders enabled', async () => {
      const prisma = {
        interviewRound: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'round1',
            stage: 'Technical',
            outcome: 'PENDING',
            scheduledAt: new Date('2026-08-05T10:00:00Z'),
            job: {
              company: 'Acme',
              position: 'Engineer',
              user: {
                id: 'u1',
                email: 'u1@test.dev',
                interviewRemindersEnabled: true,
              },
            },
          }),
        },
      };
      const processor = new NotificationsProcessor(
        prisma as any,
        email as any,
        config as any,
        logger as any,
      );

      await processor.process({
        name: 'interview-reminder',
        data: { roundId: 'round1' },
      } as any);

      expect(email.send).toHaveBeenCalledTimes(1);
      expect(email.send.mock.calls[0][0].to).toBe('u1@test.dev');
      expect(email.send.mock.calls[0][0].subject).toContain('Acme');
    });

    it('skips sending when the user has reminders disabled, and un-stamps reminderSentAt', async () => {
      const prisma = {
        interviewRound: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'round1',
            stage: 'Technical',
            outcome: 'PENDING',
            scheduledAt: new Date(),
            job: {
              company: 'Acme',
              position: 'Engineer',
              user: {
                id: 'u1',
                email: 'u1@test.dev',
                interviewRemindersEnabled: false,
              },
            },
          }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      };
      const processor = new NotificationsProcessor(
        prisma as any,
        email as any,
        config as any,
        logger as any,
      );

      await processor.process({
        name: 'interview-reminder',
        data: { roundId: 'round1' },
      } as any);

      expect(email.send).not.toHaveBeenCalled();
      // Otherwise the round would never be reconsidered if the user
      // re-enables reminders before the interview happens.
      expect(prisma.interviewRound.updateMany).toHaveBeenCalledWith({
        where: { id: 'round1', reminderSentAt: { not: null } },
        data: { reminderSentAt: null },
      });
    });

    it('skips sending when the round is no longer pending (e.g. cancelled)', async () => {
      const prisma = {
        interviewRound: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'round1',
            stage: 'Technical',
            outcome: 'CANCELLED',
            scheduledAt: new Date(),
            job: {
              company: 'Acme',
              position: 'Engineer',
              user: {
                id: 'u1',
                email: 'u1@test.dev',
                interviewRemindersEnabled: true,
              },
            },
          }),
        },
      };
      const processor = new NotificationsProcessor(
        prisma as any,
        email as any,
        config as any,
        logger as any,
      );

      await processor.process({
        name: 'interview-reminder',
        data: { roundId: 'round1' },
      } as any);

      expect(email.send).not.toHaveBeenCalled();
    });

    it('skips silently when the round no longer exists', async () => {
      const prisma = {
        interviewRound: { findUnique: jest.fn().mockResolvedValue(null) },
      };
      const processor = new NotificationsProcessor(
        prisma as any,
        email as any,
        config as any,
        logger as any,
      );

      await processor.process({
        name: 'interview-reminder',
        data: { roundId: 'missing' },
      } as any);

      expect(email.send).not.toHaveBeenCalled();
    });
  });

  describe('digest', () => {
    it('sends when there are attention items', async () => {
      const prisma = {
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'u1',
            email: 'u1@test.dev',
            digestFrequency: DigestFrequency.DAILY,
          }),
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
      const processor = new NotificationsProcessor(
        prisma as any,
        email as any,
        config as any,
        logger as any,
      );

      await processor.process({
        name: 'digest',
        data: { userId: 'u1' },
      } as any);

      expect(email.send).toHaveBeenCalledTimes(1);
    });

    it('skips when there are no attention items', async () => {
      const prisma = {
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'u1',
            email: 'u1@test.dev',
            digestFrequency: DigestFrequency.DAILY,
          }),
        },
        job: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const processor = new NotificationsProcessor(
        prisma as any,
        email as any,
        config as any,
        logger as any,
      );

      await processor.process({
        name: 'digest',
        data: { userId: 'u1' },
      } as any);

      expect(email.send).not.toHaveBeenCalled();
    });

    it('suppresses a stale item already digested for the same occurrence', async () => {
      const appliedAt = new Date('2026-07-01T00:00:00Z');
      const prisma = {
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'u1',
            email: 'u1@test.dev',
            digestFrequency: DigestFrequency.DAILY,
          }),
        },
        job: {
          findMany: jest
            .fn()
            .mockResolvedValueOnce([]) // upcoming
            .mockResolvedValueOnce([]) // stale interviewing
            .mockResolvedValueOnce([
              {
                id: 'j1',
                company: 'Acme',
                position: 'Eng',
                appliedAt,
                // already digested at (after) the same appliedAt occurrence
                staleAppliedDigestedAt: new Date('2026-07-09T00:00:00Z'),
              },
            ]),
          update: jest.fn(),
        },
      };
      const processor = new NotificationsProcessor(
        prisma as any,
        email as any,
        config as any,
        logger as any,
      );

      await processor.process({
        name: 'digest',
        data: { userId: 'u1' },
      } as any);

      expect(email.send).not.toHaveBeenCalled();
      expect(prisma.job.update).not.toHaveBeenCalled();
    });

    it('re-includes and re-stamps a stale item once the occurrence changes', async () => {
      const prisma = {
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'u1',
            email: 'u1@test.dev',
            digestFrequency: DigestFrequency.DAILY,
          }),
        },
        job: {
          findMany: jest
            .fn()
            .mockResolvedValueOnce([]) // upcoming
            .mockResolvedValueOnce([]) // stale interviewing
            .mockResolvedValueOnce([
              {
                id: 'j1',
                company: 'Acme',
                position: 'Eng',
                // digested for an earlier occurrence than the current appliedAt
                appliedAt: new Date('2026-07-20T00:00:00Z'),
                staleAppliedDigestedAt: new Date('2026-07-01T00:00:00Z'),
              },
            ]),
          update: jest.fn().mockResolvedValue(undefined),
        },
      };
      const processor = new NotificationsProcessor(
        prisma as any,
        email as any,
        config as any,
        logger as any,
      );

      await processor.process({
        name: 'digest',
        data: { userId: 'u1' },
      } as any);

      expect(email.send).toHaveBeenCalledTimes(1);
      expect(prisma.job.update).toHaveBeenCalledWith({
        where: { id: 'j1' },
        data: { staleAppliedDigestedAt: expect.any(Date) },
      });
    });

    it('does not fail the job (and re-send the email) when a dedup stamp write fails', async () => {
      const prisma = {
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'u1',
            email: 'u1@test.dev',
            digestFrequency: DigestFrequency.DAILY,
          }),
        },
        job: {
          findMany: jest
            .fn()
            .mockResolvedValueOnce([]) // upcoming
            .mockResolvedValueOnce([]) // stale interviewing
            .mockResolvedValueOnce([
              {
                id: 'j1',
                company: 'Acme',
                position: 'Eng',
                appliedAt: new Date('2026-07-20T00:00:00Z'),
                staleAppliedDigestedAt: null,
              },
            ]),
          // Simulates the job being deleted between digest computation and
          // the stamp write (e.g. Prisma P2025).
          update: jest.fn().mockRejectedValue(new Error('Record not found')),
        },
      };
      const processor = new NotificationsProcessor(
        prisma as any,
        email as any,
        config as any,
        logger as any,
      );

      await expect(
        processor.process({ name: 'digest', data: { userId: 'u1' } } as any),
      ).resolves.toBeUndefined();

      expect(email.send).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        'digest_dedup_stamp_failed',
        expect.objectContaining({ jobId: 'j1' }),
      );
    });

    it('never stamps digestedAt for UPCOMING_INTERVIEW (self-resolves via its own 48h window)', async () => {
      const prisma = {
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'u1',
            email: 'u1@test.dev',
            digestFrequency: DigestFrequency.DAILY,
          }),
        },
        job: {
          findMany: jest
            .fn()
            .mockResolvedValueOnce([
              { id: 'j1', company: 'Acme', position: 'Eng', nextInterviewAt: new Date() },
            ])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([]),
          update: jest.fn(),
        },
      };
      const processor = new NotificationsProcessor(
        prisma as any,
        email as any,
        config as any,
        logger as any,
      );

      await processor.process({
        name: 'digest',
        data: { userId: 'u1' },
      } as any);

      expect(email.send).toHaveBeenCalledTimes(1);
      expect(prisma.job.update).not.toHaveBeenCalled();
    });
  });

  describe('onFailed', () => {
    it('clears reminderSentAt once retries are exhausted for an interview-reminder job', async () => {
      const prisma = {
        interviewRound: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      };
      const processor = new NotificationsProcessor(
        prisma as any,
        email as any,
        config as any,
        logger as any,
      );

      await processor.onFailed({
        name: 'interview-reminder',
        data: { roundId: 'round1' },
        attemptsMade: 2,
        opts: { attempts: 2 },
      } as any);

      expect(prisma.interviewRound.updateMany).toHaveBeenCalledWith({
        where: { id: 'round1', reminderSentAt: { not: null } },
        data: { reminderSentAt: null },
      });
    });

    it('does nothing while attempts remain (BullMQ will retry on its own)', async () => {
      const prisma = {
        interviewRound: { updateMany: jest.fn() },
      };
      const processor = new NotificationsProcessor(
        prisma as any,
        email as any,
        config as any,
        logger as any,
      );

      await processor.onFailed({
        name: 'interview-reminder',
        data: { roundId: 'round1' },
        attemptsMade: 1,
        opts: { attempts: 2 },
      } as any);

      expect(prisma.interviewRound.updateMany).not.toHaveBeenCalled();
    });

    it('ignores failed digest jobs (day-keyed jobId already self-heals next cron run)', async () => {
      const prisma = {
        interviewRound: { updateMany: jest.fn() },
      };
      const processor = new NotificationsProcessor(
        prisma as any,
        email as any,
        config as any,
        logger as any,
      );

      await processor.onFailed({
        name: 'digest',
        data: { userId: 'u1' },
        attemptsMade: 2,
        opts: { attempts: 2 },
      } as any);

      expect(prisma.interviewRound.updateMany).not.toHaveBeenCalled();
    });
  });
});
