import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { InterviewOutcome } from '@prisma/client';
import { InterviewRoundsService } from './interview-rounds.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

const mockPrisma = {
  job: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  interviewRound: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
  },
};

describe('InterviewRoundsService', () => {
  let service: InterviewRoundsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        InterviewRoundsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(InterviewRoundsService);
  });

  describe('ownership', () => {
    it('throws NotFoundException when the job does not belong to the user', async () => {
      mockPrisma.job.findFirst.mockResolvedValue(null);

      await expect(
        service.create('user-1', 'job-1', {
          stage: 'Phone Screen',
          scheduledAt: '2026-08-01',
        }),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.interviewRound.create).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('creates the round and recomputes nextInterviewAt', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({ id: 'job-1' });
      mockPrisma.interviewRound.create.mockResolvedValue({ id: 'round-1' });
      mockPrisma.interviewRound.findFirst.mockResolvedValue({
        scheduledAt: new Date('2026-08-01T00:00:00Z'),
      });

      await service.create('user-1', 'job-1', {
        stage: 'Phone Screen',
        scheduledAt: '2026-08-01',
      });

      expect(mockPrisma.job.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: { nextInterviewAt: new Date('2026-08-01T00:00:00Z') },
      });
    });
  });

  describe('recomputeNextInterviewAt (via create)', () => {
    it('sets nextInterviewAt to the earliest future PENDING round', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({ id: 'job-1' });
      mockPrisma.interviewRound.create.mockResolvedValue({ id: 'round-1' });
      const earliest = new Date('2026-08-05T00:00:00Z');
      mockPrisma.interviewRound.findFirst.mockResolvedValue({
        scheduledAt: earliest,
      });

      await service.create('user-1', 'job-1', {
        stage: 'Technical',
        scheduledAt: '2026-08-05',
      });

      expect(mockPrisma.interviewRound.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            jobId: 'job-1',
            outcome: InterviewOutcome.PENDING,
            scheduledAt: expect.objectContaining({ gte: expect.any(Date) }),
          }),
          orderBy: { scheduledAt: 'asc' },
        }),
      );
      expect(mockPrisma.job.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: { nextInterviewAt: earliest },
      });
    });

    it('sets nextInterviewAt to null when no PENDING round remains', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({ id: 'job-1' });
      mockPrisma.interviewRound.findFirst.mockResolvedValue({
        id: 'round-1',
      });
      mockPrisma.interviewRound.update.mockResolvedValue({ id: 'round-1' });
      // No pending round left after this update (e.g. marked FAILED).
      mockPrisma.interviewRound.findFirst.mockResolvedValueOnce({
        id: 'round-1',
      });
      mockPrisma.interviewRound.findFirst.mockResolvedValueOnce(null);

      await service.update('user-1', 'job-1', 'round-1', {
        outcome: InterviewOutcome.FAILED,
      });

      expect(mockPrisma.job.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: { nextInterviewAt: null },
      });
    });
  });

  describe('update', () => {
    it('throws NotFoundException when the round does not belong to the job', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({ id: 'job-1' });
      mockPrisma.interviewRound.findFirst.mockResolvedValue(null);

      await expect(
        service.update('user-1', 'job-1', 'round-x', {
          outcome: InterviewOutcome.PASSED,
        }),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.interviewRound.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when nothing was deleted', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({ id: 'job-1' });
      mockPrisma.interviewRound.deleteMany.mockResolvedValue({ count: 0 });

      await expect(
        service.remove('user-1', 'job-1', 'round-x'),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.job.update).not.toHaveBeenCalled();
    });

    it('recomputes nextInterviewAt after a successful delete', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({ id: 'job-1' });
      mockPrisma.interviewRound.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.interviewRound.findFirst.mockResolvedValue(null);

      const result = await service.remove('user-1', 'job-1', 'round-1');

      expect(result).toEqual({ message: 'Interview round deleted' });
      expect(mockPrisma.job.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: { nextInterviewAt: null },
      });
    });
  });

  describe('findAllForJob', () => {
    it('returns rounds ordered by scheduledAt', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({ id: 'job-1' });
      mockPrisma.interviewRound.findMany.mockResolvedValue([{ id: 'r1' }]);

      const result = await service.findAllForJob('user-1', 'job-1');

      expect(mockPrisma.interviewRound.findMany).toHaveBeenCalledWith({
        where: { jobId: 'job-1' },
        orderBy: { scheduledAt: 'asc' },
      });
      expect(result).toEqual([{ id: 'r1' }]);
    });
  });
});
