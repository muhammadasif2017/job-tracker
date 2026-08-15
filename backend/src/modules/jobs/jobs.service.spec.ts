import { Test } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { CompanyCity, JobStatus, JobType } from '@prisma/client';
import { Logger } from 'nestjs-pino';
import { JobsService } from './jobs.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EnrichmentService } from '../enrichment/enrichment.service.js';
import { STORAGE_SERVICE } from '../../storage/storage.service.js';
import { CreateJobDto } from './dto/create-job.dto.js';

const mockPrisma = {
  job: {
    groupBy: jest.fn(),
    count: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
  jobEvent: { findMany: jest.fn(), create: jest.fn() },
  resume: { findFirst: jest.fn() },
  company: { findFirst: jest.fn(), create: jest.fn() },
  // See interview-rounds.service.spec.ts for why this just replays the
  // callback against the same mock instead of modeling a real transaction.
  $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(mockPrisma)),
};

const mockEnrichment = { enqueueEnrichment: jest.fn() } satisfies Pick<
  EnrichmentService,
  'enqueueEnrichment'
>;
const mockStorage = {
  upload: jest.fn(),
  getPresignedUrl: jest.fn(),
  delete: jest.fn(),
};
const mockLogger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };

describe('JobsService', () => {
  let service: JobsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.company.findFirst.mockResolvedValue(null);
    const module = await Test.createTestingModule({
      providers: [
        JobsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EnrichmentService, useValue: mockEnrichment },
        { provide: STORAGE_SERVICE, useValue: mockStorage },
        { provide: Logger, useValue: mockLogger },
      ],
    }).compile();
    service = module.get(JobsService);
  });

  describe('create', () => {
    it('calls enqueueEnrichment with the created job id', async () => {
      mockPrisma.job.create.mockResolvedValue({
        id: 'job-new',
        status: JobStatus.APPLIED,
      });
      mockEnrichment.enqueueEnrichment.mockResolvedValue(undefined);

      const dto: CreateJobDto = { company: 'Acme', position: 'Engineer' };
      await service.create('user-1', dto);

      expect(mockEnrichment.enqueueEnrichment).toHaveBeenCalledWith('job-new');
    });

    it('still returns the created job even if enqueueEnrichment throws', async () => {
      mockPrisma.job.create.mockResolvedValue({
        id: 'job-new',
        status: JobStatus.APPLIED,
      });
      mockEnrichment.enqueueEnrichment.mockRejectedValue(
        new Error('Redis down'),
      );

      const dto: CreateJobDto = { company: 'Acme', position: 'Engineer' };
      const result = await service.create('user-1', dto);

      expect(result).toMatchObject({ id: 'job-new' });
    });

    it('persists the jobType from the DTO instead of relying on the Prisma default', async () => {
      mockPrisma.job.create.mockResolvedValue({
        id: 'job-new',
        status: JobStatus.APPLIED,
      });

      const dto: CreateJobDto = {
        company: 'Acme',
        position: 'Engineer',
        jobType: JobType.REMOTE,
      };
      await service.create('user-1', dto);

      expect(mockPrisma.job.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ jobType: JobType.REMOTE }),
        }),
      );
    });

    it('defaults jobType to ONSITE when not provided', async () => {
      mockPrisma.job.create.mockResolvedValue({
        id: 'job-new',
        status: JobStatus.APPLIED,
      });

      const dto: CreateJobDto = { company: 'Acme', position: 'Engineer' };
      await service.create('user-1', dto);

      expect(mockPrisma.job.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ jobType: JobType.ONSITE }),
        }),
      );
    });

    it('returns matchedCompany when the job company case-insensitively matches a saved target company', async () => {
      mockPrisma.job.create.mockResolvedValue({
        id: 'job-new',
        status: JobStatus.APPLIED,
      });
      mockPrisma.company.findFirst.mockResolvedValue({
        id: 'company-1',
        name: 'Systems Limited',
      });

      const dto: CreateJobDto = {
        company: 'systems limited',
        position: 'Engineer',
      };
      const result = await service.create('user-1', dto);

      expect(mockPrisma.company.findFirst).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          name: { equals: 'systems limited', mode: 'insensitive' },
        },
        select: { id: true, name: true },
      });
      expect(mockPrisma.company.create).not.toHaveBeenCalled();
      expect(mockPrisma.job.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ companyId: 'company-1' }),
        }),
      );
      expect(result.matchedCompany).toEqual({
        id: 'company-1',
        name: 'Systems Limited',
      });
    });

    it('creates a new Company row (city OTHER) and links companyId when no existing target company matches', async () => {
      mockPrisma.job.create.mockResolvedValue({
        id: 'job-new',
        status: JobStatus.APPLIED,
      });
      mockPrisma.company.findFirst.mockResolvedValue(null);
      mockPrisma.company.create.mockResolvedValue({
        id: 'company-new',
        name: 'Nobody Saved This',
      });

      const dto: CreateJobDto = {
        company: 'Nobody Saved This',
        position: 'Engineer',
      };
      const result = await service.create('user-1', dto);

      expect(mockPrisma.company.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          name: 'Nobody Saved This',
          city: CompanyCity.OTHER,
        },
        select: { id: true, name: true },
      });
      expect(mockPrisma.job.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ companyId: 'company-new' }),
        }),
      );
      expect(result.matchedCompany).toEqual({
        id: 'company-new',
        name: 'Nobody Saved This',
      });
    });

    it('re-fetches instead of failing job creation when a concurrent request creates the same new company first', async () => {
      mockPrisma.job.create.mockResolvedValue({
        id: 'job-new',
        status: JobStatus.APPLIED,
      });
      mockPrisma.company.findFirst
        .mockResolvedValueOnce(null) // initial lookup: no match yet
        .mockResolvedValueOnce({ id: 'company-raced', name: 'Race Co' }); // re-fetch after the create races
      mockPrisma.company.create.mockRejectedValue(
        Object.assign(new Error('Unique constraint failed'), {
          code: 'P2002',
        }),
      );

      const dto: CreateJobDto = { company: 'Race Co', position: 'Engineer' };
      const result = await service.create('user-1', dto);

      expect(mockPrisma.company.findFirst).toHaveBeenCalledTimes(2);
      expect(result.matchedCompany).toEqual({
        id: 'company-raced',
        name: 'Race Co',
      });
    });

    it('skips the matchedCompany lookup for a whitespace-only company name', async () => {
      mockPrisma.job.create.mockResolvedValue({
        id: 'job-new',
        status: JobStatus.APPLIED,
      });

      const dto: CreateJobDto = {
        company: '   ',
        position: 'Engineer',
      };
      const result = await service.create('user-1', dto);

      expect(mockPrisma.company.findFirst).not.toHaveBeenCalled();
      expect(result.matchedCompany).toBeNull();
    });
  });

  describe('findOne', () => {
    it('includes companyProfile and resume in the Prisma query', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({
        id: 'job-1',
        companyProfile: null,
        resume: null,
      });

      await service.findOne('user-1', 'job-1');

      expect(mockPrisma.job.findFirst).toHaveBeenCalledWith({
        where: { id: 'job-1', userId: 'user-1' },
        include: {
          companyProfile: true,
          resume: true,
          interviewRounds: { orderBy: { scheduledAt: 'asc' } },
          contacts: { orderBy: { createdAt: 'asc' } },
        },
      });
    });
  });

  describe('update', () => {
    it('does not include companyProfile when checking ownership', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({
        id: 'job-1',
        status: JobStatus.APPLIED,
      });
      mockPrisma.job.update.mockResolvedValue({ id: 'job-1' });

      await service.update('user-1', 'job-1', { position: 'Staff Engineer' });

      expect(mockPrisma.job.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          select: { id: true, status: true },
        }),
      );
      expect(mockPrisma.job.findFirst).not.toHaveBeenCalledWith(
        expect.objectContaining({ include: expect.anything() }),
      );
    });

    it('creates a STATUS_CHANGE event with fromStatus and toStatus when status changes', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({
        id: 'job-1',
        status: JobStatus.APPLIED,
      });
      mockPrisma.job.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.job.update.mockResolvedValue({ id: 'job-1' });

      await service.update('user-1', 'job-1', {
        status: JobStatus.INTERVIEWING,
      });

      expect(mockPrisma.job.updateMany).toHaveBeenCalledWith({
        where: { id: 'job-1', status: JobStatus.APPLIED },
        data: { status: JobStatus.INTERVIEWING },
      });
      expect(mockPrisma.jobEvent.create).toHaveBeenCalledWith({
        data: {
          jobId: 'job-1',
          type: 'STATUS_CHANGE',
          fromStatus: JobStatus.APPLIED,
          toStatus: JobStatus.INTERVIEWING,
        },
      });
    });

    it('throws ConflictException and does not write an event when the status changed concurrently', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({
        id: 'job-1',
        status: JobStatus.APPLIED,
      });
      // Another request already moved the row off APPLIED — the CAS matches
      // zero rows.
      mockPrisma.job.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.update('user-1', 'job-1', { status: JobStatus.OFFER }),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.jobEvent.create).not.toHaveBeenCalled();
      expect(mockPrisma.job.update).not.toHaveBeenCalled();
    });

    it('does not create an event when the new status equals the existing status', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({
        id: 'job-1',
        status: JobStatus.APPLIED,
      });
      mockPrisma.job.update.mockResolvedValue({ id: 'job-1' });

      await service.update('user-1', 'job-1', { status: JobStatus.APPLIED });

      expect(mockPrisma.job.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.jobEvent.create).not.toHaveBeenCalled();
      expect(mockPrisma.job.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({ events: expect.anything() }),
        }),
      );
    });

    it('does not create an event when status is omitted from the dto', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({
        id: 'job-1',
        status: JobStatus.APPLIED,
      });
      mockPrisma.job.update.mockResolvedValue({ id: 'job-1' });

      await service.update('user-1', 'job-1', { position: 'Staff Engineer' });

      expect(mockPrisma.job.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.jobEvent.create).not.toHaveBeenCalled();
      expect(mockPrisma.job.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({ events: expect.anything() }),
        }),
      );
    });

    it('throws NotFoundException when the job does not belong to the user', async () => {
      mockPrisma.job.findFirst.mockResolvedValue(null);

      await expect(
        service.update('user-1', 'job-99', { status: JobStatus.OFFER }),
      ).rejects.toThrow('Job not found');
      expect(mockPrisma.job.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('returns success message when job is deleted', async () => {
      mockPrisma.resume.findFirst.mockResolvedValue(null);
      mockPrisma.job.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.remove('user-1', 'job-1');

      expect(result).toEqual({ message: 'Job deleted' });
    });

    it('throws NotFoundException when job does not belong to the user', async () => {
      mockPrisma.resume.findFirst.mockResolvedValue(null);
      mockPrisma.job.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.remove('user-1', 'job-99')).rejects.toThrow(
        'Job not found',
      );
    });

    it('uses deleteMany for the job delete without a separate job ownership SELECT', async () => {
      mockPrisma.resume.findFirst.mockResolvedValue(null);
      mockPrisma.job.deleteMany.mockResolvedValue({ count: 1 });

      await service.remove('user-1', 'job-1');

      expect(mockPrisma.job.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.job.deleteMany).toHaveBeenCalledWith({
        where: { id: 'job-1', userId: 'user-1' },
      });
    });

    it('deletes the resume file from storage when the job has an attached resume', async () => {
      mockPrisma.resume.findFirst.mockResolvedValue({
        storageKey: 'resumes/user-1/job-1/abc.pdf',
      });
      mockPrisma.job.deleteMany.mockResolvedValue({ count: 1 });
      mockStorage.delete.mockResolvedValue(undefined);

      await service.remove('user-1', 'job-1');

      expect(mockStorage.delete).toHaveBeenCalledWith(
        'resumes/user-1/job-1/abc.pdf',
      );
    });

    it('skips storage delete when the job has no attached resume', async () => {
      mockPrisma.resume.findFirst.mockResolvedValue(null);
      mockPrisma.job.deleteMany.mockResolvedValue({ count: 1 });

      await service.remove('user-1', 'job-1');

      expect(mockStorage.delete).not.toHaveBeenCalled();
    });
  });

  describe('getEvents', () => {
    it('returns events ordered by createdAt asc', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({
        id: 'job-1',
        status: JobStatus.APPLIED,
      });
      const events = [{ id: 'e1' }, { id: 'e2' }];
      mockPrisma.jobEvent.findMany.mockResolvedValue(events);

      const result = await service.getEvents('user-1', 'job-1');

      expect(result).toBe(events);
    });

    it('defaults to page 1 with limit 50', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({
        id: 'job-1',
        status: JobStatus.APPLIED,
      });
      mockPrisma.jobEvent.findMany.mockResolvedValue([]);

      await service.getEvents('user-1', 'job-1');

      expect(mockPrisma.jobEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 50 }),
      );
    });

    it('caps limit at 200 regardless of the requested value', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({
        id: 'job-1',
        status: JobStatus.APPLIED,
      });
      mockPrisma.jobEvent.findMany.mockResolvedValue([]);

      await service.getEvents('user-1', 'job-1', 1, 500);

      expect(mockPrisma.jobEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 200 }),
      );
    });

    it('throws NotFoundException when job does not belong to the user', async () => {
      mockPrisma.job.findFirst.mockResolvedValue(null);

      await expect(service.getEvents('user-1', 'job-99')).rejects.toThrow(
        'Job not found',
      );
    });
  });
});
