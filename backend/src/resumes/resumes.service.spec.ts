import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { ResumesService } from './resumes.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { STORAGE_SERVICE } from '../storage/storage.service.js';

const mockPrisma = {
  job: { findFirst: jest.fn() },
  resume: {
    upsert: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn(),
  },
};

const mockStorage = {
  upload: jest.fn(),
  getPresignedUrl: jest.fn(),
  delete: jest.fn(),
};

const mockLogger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };

const mockFile = {
  originalname: 'resume.pdf',
  mimetype: 'application/pdf',
  size: 2048,
  buffer: Buffer.from('pdf'),
} as Express.Multer.File;

const resumeRecord = {
  id: 'r-1',
  jobId: 'j-1',
  originalName: 'resume.pdf',
  size: 2048,
  storageKey: 'resumes/u-1/j-1/old-uuid.pdf',
  createdAt: new Date(),
};

describe('ResumesService', () => {
  let service: ResumesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        ResumesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: STORAGE_SERVICE, useValue: mockStorage },
        { provide: Logger, useValue: mockLogger },
      ],
    }).compile();
    service = module.get(ResumesService);
  });

  describe('upload', () => {
    it('throws NotFoundException when job does not belong to user', async () => {
      mockPrisma.job.findFirst.mockResolvedValue(null);
      await expect(service.upload('u-1', 'j-1', mockFile)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockStorage.upload).not.toHaveBeenCalled();
    });

    it('uploads file and creates resume record when no previous resume exists', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({ id: 'j-1', resume: null });
      mockStorage.upload.mockResolvedValue(undefined);
      mockPrisma.resume.upsert.mockResolvedValue(resumeRecord);

      const result = await service.upload('u-1', 'j-1', mockFile);

      expect(mockStorage.upload).toHaveBeenCalledWith(
        expect.stringMatching(/^resumes\/u-1\/j-1\/.+\.pdf$/),
        mockFile.buffer,
        mockFile.mimetype,
      );
      expect(mockPrisma.resume.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { jobId: 'j-1' },
          create: expect.objectContaining({ originalName: 'resume.pdf' }),
        }),
      );
      expect(mockStorage.delete).not.toHaveBeenCalled();
      const { storageKey: _sk, ...dto } = resumeRecord;
      expect(result).toEqual(dto);
    });

    it('deletes the old storage key after replacing an existing resume', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({
        id: 'j-1',
        resume: { id: 'r-old', storageKey: 'resumes/u-1/j-1/old-uuid.pdf' },
      });
      mockStorage.upload.mockResolvedValue(undefined);
      mockStorage.delete.mockResolvedValue(undefined);
      mockPrisma.resume.upsert.mockResolvedValue(resumeRecord);

      await service.upload('u-1', 'j-1', mockFile);

      expect(mockStorage.delete).toHaveBeenCalledWith(
        'resumes/u-1/j-1/old-uuid.pdf',
      );
    });

    it('deletes the new file from storage when the DB upsert fails', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({ id: 'j-1', resume: null });
      mockStorage.upload.mockResolvedValue(undefined);
      mockStorage.delete.mockResolvedValue(undefined);
      mockPrisma.resume.upsert.mockRejectedValue(new Error('DB error'));

      await expect(service.upload('u-1', 'j-1', mockFile)).rejects.toThrow(
        'DB error',
      );
      expect(mockStorage.delete).toHaveBeenCalledWith(
        expect.stringMatching(/^resumes\/u-1\/j-1\/.+\.pdf$/),
      );
    });
  });

  describe('getPresignedUrl', () => {
    it('throws NotFoundException when no resume exists for the job', async () => {
      mockPrisma.resume.findFirst.mockResolvedValue(null);
      await expect(service.getPresignedUrl('u-1', 'j-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns presigned URL and originalName', async () => {
      mockPrisma.resume.findFirst.mockResolvedValue(resumeRecord);
      mockStorage.getPresignedUrl.mockResolvedValue('https://signed-url');

      const result = await service.getPresignedUrl('u-1', 'j-1');

      expect(mockStorage.getPresignedUrl).toHaveBeenCalledWith(
        resumeRecord.storageKey,
      );
      expect(result).toEqual({
        url: 'https://signed-url',
        originalName: 'resume.pdf',
      });
    });
  });

  describe('findByJob', () => {
    it('returns null when no resume exists for the job (or job is not owned by user)', async () => {
      mockPrisma.resume.findFirst.mockResolvedValue(null);

      const result = await service.findByJob('u-1', 'j-1');
      expect(result).toBeNull();
    });

    it('queries by jobId and userId in a single Prisma call', async () => {
      mockPrisma.resume.findFirst.mockResolvedValue(resumeRecord);

      await service.findByJob('u-1', 'j-1');

      expect(mockPrisma.resume.findFirst).toHaveBeenCalledWith({
        where: { jobId: 'j-1', job: { userId: 'u-1' } },
      });
      expect(mockPrisma.job.findFirst).not.toHaveBeenCalled();
    });

    it('returns the resume DTO without storageKey when one exists', async () => {
      mockPrisma.resume.findFirst.mockResolvedValue(resumeRecord);

      const result = await service.findByJob('u-1', 'j-1');

      const { storageKey: _sk, ...dto } = resumeRecord;
      expect(result).toEqual(dto);
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when no resume exists for the job', async () => {
      mockPrisma.resume.findFirst.mockResolvedValue(null);
      await expect(service.remove('u-1', 'j-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deletes file from storage and removes the DB record', async () => {
      mockPrisma.resume.findFirst.mockResolvedValue(resumeRecord);
      mockStorage.delete.mockResolvedValue(undefined);
      mockPrisma.resume.delete.mockResolvedValue(resumeRecord);

      await service.remove('u-1', 'j-1');

      expect(mockStorage.delete).toHaveBeenCalledWith(resumeRecord.storageKey);
      expect(mockPrisma.resume.delete).toHaveBeenCalledWith({
        where: { id: resumeRecord.id },
      });
    });

    it('returns a success message', async () => {
      mockPrisma.resume.findFirst.mockResolvedValue(resumeRecord);
      mockStorage.delete.mockResolvedValue(undefined);
      mockPrisma.resume.delete.mockResolvedValue(resumeRecord);

      const result = await service.remove('u-1', 'j-1');
      expect(result).toEqual({ message: 'Resume removed' });
    });
  });
});
