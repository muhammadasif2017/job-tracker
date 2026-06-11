import { Test } from '@nestjs/testing';
import { JobStatus } from '@prisma/client';
import { JobsService } from './jobs.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { JobQueryDto } from './dto/job-query.dto.js';

const mockPrisma = {
  job: {
    groupBy: jest.fn(),
    count: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  jobEvent: { findMany: jest.fn() },
};

describe('JobsService', () => {
  let service: JobsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        JobsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(JobsService);
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
      // total is called before thisMonth inside Promise.all
      mockPrisma.job.count.mockResolvedValueOnce(10).mockResolvedValueOnce(4);

      const stats = await service.getStats('u1');

      // responded = INTERVIEWING(3) + OFFER(1) + REJECTED(1) = 5 / 10 total = 50%
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

      // CSV spec: each " inside a quoted field is doubled
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

      // null location sits between Status and Applied Date — both neighbors are non-null
      expect(row).toContain(',"",');
    });
  });
});
