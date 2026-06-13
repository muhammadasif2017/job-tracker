import { Test } from '@nestjs/testing';
import { JobStatus } from '@prisma/client';
import { JobsService } from './jobs.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { EnrichmentService } from '../enrichment/enrichment.service.js';
import { STORAGE_SERVICE } from '../storage/storage.service.js';
import { JobQueryDto } from './dto/job-query.dto.js';
import { CreateJobDto } from './dto/create-job.dto.js';

const mockPrisma = {
  job: {
    groupBy: jest.fn(),
    count: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
  jobEvent: { findMany: jest.fn() },
  resume: { findFirst: jest.fn() },
};

const mockEnrichment = { enqueueEnrichment: jest.fn() };
const mockStorage = {
  upload: jest.fn(),
  getPresignedUrl: jest.fn(),
  delete: jest.fn(),
};

describe('JobsService', () => {
  let service: JobsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        JobsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EnrichmentService, useValue: mockEnrichment },
        { provide: STORAGE_SERVICE, useValue: mockStorage },
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
        include: { companyProfile: true, resume: true },
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

    it('caps the query at 200 events', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({
        id: 'job-1',
        status: JobStatus.APPLIED,
      });
      mockPrisma.jobEvent.findMany.mockResolvedValue([]);

      await service.getEvents('user-1', 'job-1');

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

  describe('getStats', () => {
    it('zero-fills every status when the DB returns no rows', async () => {
      mockPrisma.job.groupBy.mockResolvedValue([]);
      mockPrisma.job.count.mockResolvedValue(0);

      const stats = await service.getStats('u1');

      expect(stats.total).toBe(0);
      expect(stats.thisMonth).toBe(0);
      expect(stats.responseRate).toBe(0);
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

      const stats = await service.getStats('u1');

      expect(stats.responseRate).toBe(50);
      expect(stats.total).toBe(10);
      expect(stats.thisMonth).toBe(4);
      expect(stats.byStatus[JobStatus.APPLIED]).toBe(5);
      expect(stats.byStatus[JobStatus.WISHLIST]).toBe(0);
    });
  });

  describe('exportCsv', () => {
    it('produces the correct header row', async () => {
      mockPrisma.job.findMany.mockResolvedValue([]);

      const csv = await service.exportCsv('u1', new JobQueryDto());

      expect(csv.split('\r\n')[0]).toBe(
        'Company,Position,Status,Location,Applied Date,Next Interview,URL,Notes',
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

      const csv = await service.exportCsv('u1', new JobQueryDto());
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

      const csv = await service.exportCsv('u1', new JobQueryDto());
      const row = csv.split('\r\n')[1];

      expect(row).toContain(',"",');
    });
  });
});
