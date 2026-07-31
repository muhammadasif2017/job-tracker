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
          findFirst: jest.fn().mockResolvedValue({
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

    it('skips sending when the user has reminders disabled', async () => {
      const prisma = {
        interviewRound: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'round1',
            stage: 'Technical',
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

    it('skips sending when the round is no longer pending (e.g. cancelled)', async () => {
      const prisma = {
        interviewRound: {
          findFirst: jest.fn().mockResolvedValue({
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
        interviewRound: { findFirst: jest.fn().mockResolvedValue(null) },
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
          findFirst: jest.fn().mockResolvedValue({
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
          findFirst: jest.fn().mockResolvedValue({
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
  });
});
