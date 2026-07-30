import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InterviewOutcome, JobStatus, JobEventType } from '@prisma/client';
import { InterviewRoundsService } from './interview-rounds.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

const mockPrisma = {
  job: {
    findFirst: jest.fn(),
    updateMany: jest.fn(),
    findUniqueOrThrow: jest.fn(),
  },
  interviewRound: {
    create: jest.fn(),
    count: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
  },
  jobEvent: {
    create: jest.fn(),
  },
  // recomputeNextInterviewAt is a single raw UPDATE (see interview-rounds.service.ts)
  // so there's nothing meaningful to assert about its *result* at the mock
  // level — that's what the backend e2e suite verifies against real Postgres.
  // The unit tests here only confirm it's invoked, with the job id bound in.
  $executeRaw: jest.fn(),
  // Real $transaction opens a DB transaction and hands the callback a scoped
  // client; here it just replays the callback against the same mock so
  // existing call assertions (mockPrisma.jobEvent.create, etc.) keep working
  // unchanged — the transaction boundary itself isn't observable via mocks.
  $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(mockPrisma)),
};

// $executeRaw is called as a tagged template: (strings, jobId, jobId) —
// the SQL interpolates the job id twice (subquery WHERE + outer WHERE).
function expectRecomputeCalledFor(jobId: string) {
  expect(mockPrisma.$executeRaw).toHaveBeenCalledWith(
    expect.anything(),
    jobId,
    jobId,
  );
}

describe('InterviewRoundsService', () => {
  let service: InterviewRoundsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Default CAS outcome: status isn't APPLIED, so logRoundEvent falls
    // through to the INTERVIEW_ROUND_ADDED branch unless a test overrides it.
    mockPrisma.job.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.job.findUniqueOrThrow.mockResolvedValue({
      status: JobStatus.APPLIED,
    });
    mockPrisma.interviewRound.count.mockResolvedValue(0);
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

      await service.create('user-1', 'job-1', {
        stage: 'Phone Screen',
        scheduledAt: '2026-08-01',
      });

      expectRecomputeCalledFor('job-1');
    });

    it('performs the round create inside a single transaction', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({ id: 'job-1' });
      mockPrisma.interviewRound.create.mockResolvedValue({ id: 'round-1' });

      await service.create('user-1', 'job-1', {
        stage: 'Onsite',
        scheduledAt: '2026-08-05',
      });

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('rejects with BadRequestException once the job hits the round cap', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({ id: 'job-1' });
      mockPrisma.interviewRound.count.mockResolvedValue(50);

      await expect(
        service.create('user-1', 'job-1', {
          stage: 'One too many',
          scheduledAt: '2026-08-05',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.interviewRound.create).not.toHaveBeenCalled();
    });
  });

  describe('round event logging', () => {
    it('promotes APPLIED to INTERVIEWING with a STATUS_CHANGE event', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({ id: 'job-1' });
      mockPrisma.job.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.interviewRound.create.mockResolvedValue({ id: 'round-1' });

      await service.create('user-1', 'job-1', {
        stage: 'Phone Screen',
        scheduledAt: '2026-08-01',
      });

      expect(mockPrisma.job.updateMany).toHaveBeenCalledWith({
        where: { id: 'job-1', status: JobStatus.APPLIED },
        data: { status: JobStatus.INTERVIEWING },
      });
      expect(mockPrisma.jobEvent.create).toHaveBeenCalledWith({
        data: {
          jobId: 'job-1',
          type: JobEventType.STATUS_CHANGE,
          fromStatus: JobStatus.APPLIED,
          toStatus: JobStatus.INTERVIEWING,
          note: 'Phone Screen',
        },
      });
      expect(mockPrisma.job.findUniqueOrThrow).not.toHaveBeenCalled();
    });

    it.each([
      JobStatus.WISHLIST,
      JobStatus.INTERVIEWING,
      JobStatus.OFFER,
      JobStatus.REJECTED,
      JobStatus.GHOSTED,
    ])(
      'logs an INTERVIEW_ROUND_ADDED event instead of promoting when the job is already %s',
      async (status) => {
        mockPrisma.job.findFirst.mockResolvedValue({ id: 'job-1' });
        mockPrisma.job.updateMany.mockResolvedValue({ count: 0 });
        mockPrisma.job.findUniqueOrThrow.mockResolvedValue({ status });
        mockPrisma.interviewRound.create.mockResolvedValue({ id: 'round-2' });

        await service.create('user-1', 'job-1', {
          stage: 'Onsite',
          scheduledAt: '2026-08-05',
        });

        expect(mockPrisma.job.updateMany).toHaveBeenCalledWith({
          where: { id: 'job-1', status: JobStatus.APPLIED },
          data: { status: JobStatus.INTERVIEWING },
        });
        expect(mockPrisma.jobEvent.create).toHaveBeenCalledWith({
          data: {
            jobId: 'job-1',
            type: JobEventType.INTERVIEW_ROUND_ADDED,
            toStatus: status,
            note: 'Onsite',
          },
        });
      },
    );

    it('logs a single INTERVIEW_ROUND_ADDED event (not a duplicate STATUS_CHANGE) when the promotion CAS loses a race', async () => {
      // Simulates a concurrent request having already won the APPLIED ->
      // INTERVIEWING promotion: our updateMany matches zero rows even though
      // the job started out APPLIED from this request's point of view.
      mockPrisma.job.findFirst.mockResolvedValue({ id: 'job-1' });
      mockPrisma.job.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.job.findUniqueOrThrow.mockResolvedValue({
        status: JobStatus.INTERVIEWING,
      });
      mockPrisma.interviewRound.create.mockResolvedValue({ id: 'round-3' });

      await service.create('user-1', 'job-1', {
        stage: 'Phone Screen',
        scheduledAt: '2026-08-01',
      });

      expect(mockPrisma.jobEvent.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.jobEvent.create).toHaveBeenCalledWith({
        data: {
          jobId: 'job-1',
          type: JobEventType.INTERVIEW_ROUND_ADDED,
          toStatus: JobStatus.INTERVIEWING,
          note: 'Phone Screen',
        },
      });
    });

    it('does not promote status on round update', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({ id: 'job-1' });
      mockPrisma.interviewRound.findFirst.mockResolvedValue({ id: 'round-1' });
      mockPrisma.interviewRound.update.mockResolvedValue({ id: 'round-1' });

      await service.update('user-1', 'job-1', 'round-1', {
        outcome: InterviewOutcome.PASSED,
      });

      expect(mockPrisma.job.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.jobEvent.create).not.toHaveBeenCalled();
    });

    it('does not promote status on round removal', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({ id: 'job-1' });
      mockPrisma.interviewRound.deleteMany.mockResolvedValue({ count: 1 });

      await service.remove('user-1', 'job-1', 'round-1');

      expect(mockPrisma.job.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.jobEvent.create).not.toHaveBeenCalled();
    });
  });

  describe('recomputeNextInterviewAt', () => {
    it('is invoked after a round create, scoped to the job id', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({ id: 'job-1' });
      mockPrisma.interviewRound.create.mockResolvedValue({ id: 'round-1' });

      await service.create('user-1', 'job-1', {
        stage: 'Technical',
        scheduledAt: '2026-08-05',
      });

      expectRecomputeCalledFor('job-1');
    });

    it('is invoked after a round outcome update, scoped to the job id', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({ id: 'job-1' });
      mockPrisma.interviewRound.findFirst.mockResolvedValue({
        id: 'round-1',
      });
      mockPrisma.interviewRound.update.mockResolvedValue({ id: 'round-1' });

      await service.update('user-1', 'job-1', 'round-1', {
        outcome: InterviewOutcome.FAILED,
      });

      expectRecomputeCalledFor('job-1');
    });

    it('is invoked after a round delete, scoped to the job id', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({ id: 'job-1' });
      mockPrisma.interviewRound.deleteMany.mockResolvedValue({ count: 1 });

      await service.remove('user-1', 'job-1', 'round-1');

      expectRecomputeCalledFor('job-1');
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
      expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('recomputes nextInterviewAt after a successful delete', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({ id: 'job-1' });
      mockPrisma.interviewRound.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.remove('user-1', 'job-1', 'round-1');

      expect(result).toEqual({ message: 'Interview round deleted' });
      expectRecomputeCalledFor('job-1');
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
