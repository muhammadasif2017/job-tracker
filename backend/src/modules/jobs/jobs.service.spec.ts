import { Test } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import {
  CompanyCity,
  EnrichmentStatus,
  InterviewOutcome,
  JobStatus,
  JobType,
} from '@prisma/client';
import { Logger } from 'nestjs-pino';
import { JobsService } from './jobs.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CompanyEnrichmentService } from '../companies/enrichment/company-enrichment.service.js';
import { TimelineSummaryService } from '../timeline-summary/timeline-summary.service.js';
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
  jobEvent: { findMany: jest.fn(), create: jest.fn(), count: jest.fn() },
  resume: { findFirst: jest.fn() },
  company: { findFirst: jest.fn(), create: jest.fn() },
  // See interview-rounds.service.spec.ts for why this just replays the
  // callback against the same mock instead of modeling a real transaction.
  $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(mockPrisma)),
};

const mockCompanyEnrichment = { enqueueEnrichment: jest.fn() } satisfies Pick<
  CompanyEnrichmentService,
  'enqueueEnrichment'
>;
const mockTimelineSummary = { enqueue: jest.fn() } satisfies Pick<
  TimelineSummaryService,
  'enqueue'
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
        { provide: CompanyEnrichmentService, useValue: mockCompanyEnrichment },
        { provide: TimelineSummaryService, useValue: mockTimelineSummary },
        { provide: STORAGE_SERVICE, useValue: mockStorage },
        { provide: Logger, useValue: mockLogger },
      ],
    }).compile();
    service = module.get(JobsService);
  });

  describe('create', () => {
    it('calls enqueueEnrichment with the linked company id, not the job id', async () => {
      mockPrisma.job.create.mockResolvedValue({
        id: 'job-new',
        status: JobStatus.APPLIED,
      });
      mockPrisma.company.create.mockResolvedValue({
        id: 'company-new',
        name: 'Acme',
      });
      mockCompanyEnrichment.enqueueEnrichment.mockResolvedValue(undefined);

      const dto: CreateJobDto = { company: 'Acme', position: 'Engineer' };
      await service.create('user-1', dto);

      expect(mockCompanyEnrichment.enqueueEnrichment).toHaveBeenCalledWith(
        'company-new',
      );
    });

    it('does not call enqueueEnrichment when the company name is blank', async () => {
      mockPrisma.job.create.mockResolvedValue({
        id: 'job-new',
        status: JobStatus.APPLIED,
      });

      const dto: CreateJobDto = { company: '   ', position: 'Engineer' };
      await service.create('user-1', dto);

      expect(mockCompanyEnrichment.enqueueEnrichment).not.toHaveBeenCalled();
    });

    it('still returns the created job even if enqueueEnrichment throws', async () => {
      mockPrisma.job.create.mockResolvedValue({
        id: 'job-new',
        status: JobStatus.APPLIED,
      });
      mockPrisma.company.create.mockResolvedValue({
        id: 'company-new',
        name: 'Acme',
      });
      mockCompanyEnrichment.enqueueEnrichment.mockRejectedValue(
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
      // matchedCompany drives the "saved as a target company" banner — must
      // stay null for a row we just silently auto-created, even though the
      // job is still linked to it via companyId.
      expect(result.matchedCompany).toBeNull();
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
      expect(mockPrisma.job.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ companyId: 'company-raced' }),
        }),
      );
      expect(result.matchedCompany).toBeNull();
    });

    it('retries the transaction when a write conflict is not a same-name race (different company predicate-locked the same range)', async () => {
      mockPrisma.job.create.mockResolvedValue({
        id: 'job-new',
        status: JobStatus.APPLIED,
      });
      mockPrisma.company.findFirst
        .mockResolvedValueOnce(null) // attempt 1: initial lookup, no match
        .mockResolvedValueOnce(null) // re-fetch after conflict: not a same-name race
        .mockResolvedValueOnce(null); // attempt 2: initial lookup, no match
      mockPrisma.company.create
        .mockRejectedValueOnce(
          Object.assign(new Error('could not serialize access'), {
            code: 'P2034',
          }),
        )
        .mockResolvedValueOnce({ id: 'company-retried', name: 'Retry Co' });

      const dto: CreateJobDto = { company: 'Retry Co', position: 'Engineer' };
      const result = await service.create('user-1', dto);

      expect(mockPrisma.company.findFirst).toHaveBeenCalledTimes(3);
      expect(mockPrisma.company.create).toHaveBeenCalledTimes(2);
      expect(mockPrisma.job.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ companyId: 'company-retried' }),
        }),
      );
      expect(result.matchedCompany).toBeNull();
    });

    // The retry loop gives up after MAX_ATTEMPTS. What it throws then is the
    // difference between a caller being told to retry and a caller seeing an
    // unexplained 500: GlobalExceptionFilter maps only P2002 and P2025, so a
    // raw P2034 escaping here lands as "Internal server error".
    it('reports a 409, not a raw serialization error, once the retry budget is exhausted', async () => {
      mockPrisma.company.findFirst.mockResolvedValue(null);
      mockPrisma.company.create.mockRejectedValue(
        Object.assign(new Error('could not serialize access'), {
          code: 'P2034',
        }),
      );

      const dto: CreateJobDto = { company: 'Busy Co', position: 'Engineer' };

      await expect(service.create('user-1', dto)).rejects.toThrow(
        ConflictException,
      );
      expect(mockPrisma.job.create).not.toHaveBeenCalled();
    });

    it('enqueues a timeline-summary regen after job creation', async () => {
      mockPrisma.job.create.mockResolvedValue({
        id: 'job-new',
        status: JobStatus.APPLIED,
      });
      // Explicit, not relying on the default from beforeEach — a prior test
      // in this file leaves company.create's persistent mock rejecting with
      // P2002, and jest.clearAllMocks() doesn't reset mockRejectedValue.
      mockPrisma.company.create.mockResolvedValue({
        id: 'company-new',
        name: 'Acme',
      });

      const dto: CreateJobDto = { company: 'Acme', position: 'Engineer' };
      await service.create('user-1', dto);

      expect(mockTimelineSummary.enqueue).toHaveBeenCalledWith('job-new');
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
    it('includes companyLink and resume in the Prisma query', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({
        id: 'job-1',
        companyLink: null,
        resume: null,
        interviewRounds: [],
      });

      await service.findOne('user-1', 'job-1');

      expect(mockPrisma.job.findFirst).toHaveBeenCalledWith({
        where: { id: 'job-1', userId: 'user-1' },
        include: {
          companyLink: true,
          resume: true,
          interviewRounds: { orderBy: { scheduledAt: 'asc' } },
          contacts: { orderBy: { createdAt: 'asc' } },
        },
      });
    });

    it('reshapes the linked Company into the companyProfile response shape', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({
        id: 'job-1',
        companyLink: {
          id: 'company-1',
          status: EnrichmentStatus.COMPLETED,
          industry: 'Software',
          companySize: '51-200',
          techStack: ['TypeScript'],
          cultureSummary: 'Remote-friendly',
          workPolicy: 'Hybrid',
          workLifeBalance: 'Good',
          headquarters: 'Lahore',
          headquartersLowConfidence: false,
          address: '123 Main St',
          addressLowConfidence: false,
          founded: '2010',
          errorMessage: null,
          enrichedAt: new Date('2026-01-01'),
          createdAt: new Date('2025-12-01'),
          updatedAt: new Date('2026-01-01'),
        },
        resume: null,
        interviewRounds: [],
      });

      const result = await service.findOne('user-1', 'job-1');

      expect(result.companyProfile).toEqual({
        id: 'company-1',
        jobId: 'job-1',
        status: EnrichmentStatus.COMPLETED,
        industry: 'Software',
        companySize: '51-200',
        techStack: ['TypeScript'],
        cultureSummary: 'Remote-friendly',
        workPolicy: 'Hybrid',
        workLifeBalance: 'Good',
        headquarters: 'Lahore',
        headquartersLowConfidence: false,
        address: '123 Main St',
        addressLowConfidence: false,
        founded: '2010',
        errorMessage: null,
        enrichedAt: new Date('2026-01-01'),
        createdAt: new Date('2025-12-01'),
        updatedAt: new Date('2026-01-01'),
      });
      expect(result).not.toHaveProperty('companyLink');
    });

    it('defaults status to PENDING for a manually-added target company that has never had enrichment triggered', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({
        id: 'job-1',
        companyLink: { id: 'company-1', status: null },
        resume: null,
        interviewRounds: [],
      });

      const result = await service.findOne('user-1', 'job-1');

      expect(result.companyProfile).toMatchObject({
        status: EnrichmentStatus.PENDING,
      });
    });

    it('returns companyProfile: null when there is no linked Company', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({
        id: 'job-1',
        companyLink: null,
        resume: null,
        interviewRounds: [],
      });

      const result = await service.findOne('user-1', 'job-1');

      expect(result.companyProfile).toBeNull();
    });

    it('attaches derivedStatus to each interview round', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({
        id: 'job-1',
        companyLink: null,
        resume: null,
        interviewRounds: [
          {
            id: 'round-1',
            outcome: InterviewOutcome.PENDING,
            scheduledAt: new Date('2020-01-01T00:00:00.000Z'),
          },
          {
            id: 'round-2',
            outcome: InterviewOutcome.PASSED,
            scheduledAt: new Date(),
          },
        ],
      });

      const result = await service.findOne('user-1', 'job-1');

      expect(result.interviewRounds[0]).toMatchObject({
        id: 'round-1',
        derivedStatus: 'POSSIBLY_GHOSTED',
      });
      expect(result.interviewRounds[1]).toMatchObject({
        id: 'round-2',
        derivedStatus: 'PASSED',
      });
    });
  });

  describe('update', () => {
    it('does not include companyProfile when checking ownership', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({
        id: 'job-1',
        status: JobStatus.APPLIED,
        company: 'Old Co',
        companyId: 'company-1',
      });
      mockPrisma.job.update.mockResolvedValue({ id: 'job-1' });

      await service.update('user-1', 'job-1', { position: 'Staff Engineer' });

      expect(mockPrisma.job.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          select: { id: true, status: true, company: true, companyId: true },
        }),
      );
      expect(mockPrisma.job.findFirst).not.toHaveBeenCalledWith(
        expect.objectContaining({ include: expect.anything() }),
      );
    });

    it('persists an edited jobType — it is a plain updatable field, unlike status', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({
        id: 'job-1',
        status: JobStatus.APPLIED,
        company: 'Old Co',
        companyId: 'company-1',
      });
      mockPrisma.job.update.mockResolvedValue({ id: 'job-1' });

      await service.update('user-1', 'job-1', { jobType: JobType.REMOTE });

      expect(mockPrisma.job.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ jobType: JobType.REMOTE }),
        }),
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
      expect(mockTimelineSummary.enqueue).not.toHaveBeenCalled();
    });

    it('enqueues a timeline-summary regen after a status change', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({
        id: 'job-1',
        status: JobStatus.APPLIED,
      });
      mockPrisma.job.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.job.update.mockResolvedValue({ id: 'job-1' });

      await service.update('user-1', 'job-1', {
        status: JobStatus.INTERVIEWING,
      });

      expect(mockTimelineSummary.enqueue).toHaveBeenCalledWith('job-1');
    });

    it('does not enqueue a timeline-summary regen when the status is unchanged', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({
        id: 'job-1',
        status: JobStatus.APPLIED,
      });
      mockPrisma.job.update.mockResolvedValue({ id: 'job-1' });

      await service.update('user-1', 'job-1', { position: 'Staff Engineer' });

      expect(mockTimelineSummary.enqueue).not.toHaveBeenCalled();
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

    it('re-links companyId to a matching existing company when dto.company changes', async () => {
      mockPrisma.job.findFirst.mockResolvedValueOnce({
        id: 'job-1',
        status: JobStatus.APPLIED,
        company: 'Old Co',
        companyId: 'company-1',
      }); // findOwned
      mockPrisma.company.findFirst.mockResolvedValueOnce({
        id: 'company-2',
        name: 'New Co',
      }); // resolveCompanyId
      mockPrisma.job.update.mockResolvedValue({ id: 'job-1' });

      await service.update('user-1', 'job-1', { company: 'New Co' });

      expect(mockPrisma.company.create).not.toHaveBeenCalled();
      expect(mockPrisma.job.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            company: 'New Co',
            companyId: 'company-2',
          }),
        }),
      );
    });

    it('creates a new Company and links companyId when dto.company matches nothing existing', async () => {
      mockPrisma.job.findFirst.mockResolvedValueOnce({
        id: 'job-1',
        status: JobStatus.APPLIED,
        company: 'Old Co',
        companyId: 'company-1',
      }); // findOwned
      mockPrisma.company.findFirst.mockResolvedValueOnce(null); // resolveCompanyId: no match
      mockPrisma.company.create.mockResolvedValue({
        id: 'company-new',
        name: 'Brand New Co',
      });
      mockPrisma.job.update.mockResolvedValue({ id: 'job-1' });

      await service.update('user-1', 'job-1', { company: 'Brand New Co' });

      expect(mockPrisma.company.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          name: 'Brand New Co',
          city: CompanyCity.OTHER,
        },
        select: { id: true, name: true },
      });
      expect(mockPrisma.job.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ companyId: 'company-new' }),
        }),
      );
    });

    it('unlinks companyId when dto.company is cleared to a blank string', async () => {
      mockPrisma.job.findFirst.mockResolvedValueOnce({
        id: 'job-1',
        status: JobStatus.APPLIED,
        company: 'Old Co',
        companyId: 'company-1',
      }); // findOwned only — resolveCompanyId short-circuits on blank name
      mockPrisma.job.update.mockResolvedValue({ id: 'job-1' });

      await service.update('user-1', 'job-1', { company: '   ' });

      expect(mockPrisma.company.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.job.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ companyId: null }),
        }),
      );
    });

    it('does not re-resolve company when dto.company matches the currently linked label (case-insensitive)', async () => {
      mockPrisma.job.findFirst.mockResolvedValueOnce({
        id: 'job-1',
        status: JobStatus.APPLIED,
        company: 'Google',
        companyId: 'company-1',
      }); // findOwned
      mockPrisma.job.update.mockResolvedValue({ id: 'job-1' });

      // Simulates JobForm resending the pre-filled, unchanged label
      // (differing only in case) alongside an edit to some other field.
      await service.update('user-1', 'job-1', {
        company: 'google',
        position: 'Staff Engineer',
      });

      expect(mockPrisma.company.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.company.create).not.toHaveBeenCalled();
      expect(mockPrisma.job.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({ companyId: expect.anything() }),
        }),
      );
    });

    it('rejects an explicit null company instead of crashing on .trim()', async () => {
      mockPrisma.job.findFirst.mockResolvedValueOnce({
        id: 'job-1',
        status: JobStatus.APPLIED,
      }); // findOwned

      await expect(
        service.update(
          'user-1',
          'job-1',
          // dto.company is typed `string | undefined`, but class-validator's
          // IsOptional() lets an actual `null` past the ValidationPipe —
          // this is the shape a client sending {"company": null} produces.
          { company: null } as unknown as { company?: string },
        ),
      ).rejects.toThrow('company cannot be cleared');
      expect(mockPrisma.company.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.job.update).not.toHaveBeenCalled();
    });

    it('does not touch companyId when dto.company is omitted', async () => {
      mockPrisma.job.findFirst.mockResolvedValueOnce({
        id: 'job-1',
        status: JobStatus.APPLIED,
      });
      mockPrisma.job.update.mockResolvedValue({ id: 'job-1' });

      await service.update('user-1', 'job-1', { position: 'Staff Engineer' });

      expect(mockPrisma.company.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.job.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({ companyId: expect.anything() }),
        }),
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
      mockPrisma.jobEvent.count.mockResolvedValue(2);

      const result = await service.getEvents('user-1', 'job-1');

      expect(result.data).toBe(events);
    });

    it('defaults to page 1 with limit 50', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({
        id: 'job-1',
        status: JobStatus.APPLIED,
      });
      mockPrisma.jobEvent.findMany.mockResolvedValue([]);
      mockPrisma.jobEvent.count.mockResolvedValue(0);

      const result = await service.getEvents('user-1', 'job-1');

      expect(mockPrisma.jobEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 50 }),
      );
      expect(result.meta).toEqual({
        total: 0,
        page: 1,
        limit: 50,
        totalPages: 0,
      });
    });

    it('caps limit at 200 regardless of the requested value', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({
        id: 'job-1',
        status: JobStatus.APPLIED,
      });
      mockPrisma.jobEvent.findMany.mockResolvedValue([]);
      mockPrisma.jobEvent.count.mockResolvedValue(0);

      const result = await service.getEvents('user-1', 'job-1', 1, 500);

      expect(mockPrisma.jobEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 200 }),
      );
      // meta.limit reports the capped take, not the raw requested limit.
      expect(result.meta.limit).toBe(200);
    });

    it('rounds totalPages up for a non-exact division', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({
        id: 'job-1',
        status: JobStatus.APPLIED,
      });
      mockPrisma.jobEvent.findMany.mockResolvedValue([]);
      mockPrisma.jobEvent.count.mockResolvedValue(105);

      const result = await service.getEvents('user-1', 'job-1', 1, 50);

      expect(result.meta.totalPages).toBe(3);
    });

    it('does not round up totalPages for an exact division', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({
        id: 'job-1',
        status: JobStatus.APPLIED,
      });
      mockPrisma.jobEvent.findMany.mockResolvedValue([]);
      mockPrisma.jobEvent.count.mockResolvedValue(100);

      const result = await service.getEvents('user-1', 'job-1', 1, 50);

      expect(result.meta.totalPages).toBe(2);
    });

    it('returns an empty page with the true total when paging past the last page', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({
        id: 'job-1',
        status: JobStatus.APPLIED,
      });
      // findMany legitimately returns [] once skip exceeds the row count —
      // count() is independent and still reports the real total.
      mockPrisma.jobEvent.findMany.mockResolvedValue([]);
      mockPrisma.jobEvent.count.mockResolvedValue(2);

      const result = await service.getEvents('user-1', 'job-1', 5, 50);

      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(2);
      expect(result.meta.totalPages).toBe(1);
    });

    it('throws NotFoundException when job does not belong to the user', async () => {
      mockPrisma.job.findFirst.mockResolvedValue(null);

      await expect(service.getEvents('user-1', 'job-99')).rejects.toThrow(
        'Job not found',
      );
    });
  });
});
