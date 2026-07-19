import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import type { Response } from 'express';
import { ResumesController } from './resumes.controller.js';
import { ResumesService } from './resumes.service.js';

jest.mock('fs/promises');
const mockFs = fs as jest.Mocked<typeof fs>;

const mockService = {
  upload: jest.fn(),
  getPresignedUrl: jest.fn(),
  findByJob: jest.fn(),
  getFileInfo: jest.fn(),
  remove: jest.fn(),
};

const mockConfig = { get: jest.fn().mockReturnValue('local') };

const user = { id: 'u-1' };
interface MockRes {
  setHeader: jest.Mock;
  sendFile: jest.Mock;
}
const mockRes = (): MockRes => ({ setHeader: jest.fn(), sendFile: jest.fn() });

describe('ResumesController', () => {
  let controller: ResumesController;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockConfig.get.mockReturnValue('local');
    const module = await Test.createTestingModule({
      controllers: [ResumesController],
      providers: [
        { provide: ResumesService, useValue: mockService },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    controller = module.get(ResumesController);
  });

  describe('uploadResume', () => {
    it('delegates to service with userId, jobId, and file', async () => {
      const file = { originalname: 'cv.pdf' } as Express.Multer.File;
      mockService.upload.mockResolvedValue({ id: 'r-1' });

      await controller.uploadResume(user, 'j-1', file);

      expect(mockService.upload).toHaveBeenCalledWith('u-1', 'j-1', file);
    });

    it('returns the result from the service', async () => {
      const file = { originalname: 'cv.pdf' } as Express.Multer.File;
      const resume = { id: 'r-1', originalName: 'cv.pdf', size: 1024 };
      mockService.upload.mockResolvedValue(resume);

      const result = await controller.uploadResume(user, 'j-1', file);

      expect(result).toEqual(resume);
    });
  });

  describe('getPresignedUrl', () => {
    it('delegates to service with userId and jobId', async () => {
      mockService.getPresignedUrl.mockResolvedValue({
        url: 'https://signed',
        originalName: 'cv.pdf',
      });

      await controller.getPresignedUrl(user, 'j-1');

      expect(mockService.getPresignedUrl).toHaveBeenCalledWith('u-1', 'j-1');
    });
  });

  describe('findByJob', () => {
    it('delegates to service with userId and jobId', async () => {
      mockService.findByJob.mockResolvedValue(null);

      await controller.findByJob(user, 'j-1');

      expect(mockService.findByJob).toHaveBeenCalledWith('u-1', 'j-1');
    });

    it('returns null when the job has no resume', async () => {
      mockService.findByJob.mockResolvedValue(null);

      const result = await controller.findByJob(user, 'j-1');

      expect(result).toBeNull();
    });
  });

  describe('remove', () => {
    it('delegates to service with userId and jobId', async () => {
      mockService.remove.mockResolvedValue({ message: 'Resume removed' });

      await controller.remove(user, 'j-1');

      expect(mockService.remove).toHaveBeenCalledWith('u-1', 'j-1');
    });

    it('returns the success message from the service', async () => {
      mockService.remove.mockResolvedValue({ message: 'Resume removed' });

      const result = await controller.remove(user, 'j-1');

      expect(result).toEqual({ message: 'Resume removed' });
    });
  });

  describe('serveFile', () => {
    const resumeDto = {
      id: 'r-1',
      jobId: 'j-1',
      originalName: 'my resume.pdf',
      size: 2048,
      createdAt: new Date(),
    };

    beforeEach(() => {
      mockService.findByJob.mockResolvedValue(resumeDto);
      mockService.getFileInfo.mockResolvedValue({
        storageKey: 'resumes/u-1/j-1/abc.pdf',
        originalName: resumeDto.originalName,
      });
    });

    it('throws NotFoundException when STORAGE_DRIVER is oracle', async () => {
      mockConfig.get.mockReturnValue('oracle');
      await expect(
        controller.serveFile(
          user,
          'resumes/u-1/j-1/abc.pdf',
          '',
          mockRes() as unknown as Response,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when key is missing', async () => {
      await expect(
        controller.serveFile(user, '', '', mockRes() as unknown as Response),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ForbiddenException when key userId segment does not match caller', async () => {
      await expect(
        controller.serveFile(
          { id: 'other-user' },
          'resumes/u-1/j-1/abc.pdf',
          '',
          mockRes() as unknown as Response,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException for a path traversal attempt', async () => {
      await expect(
        controller.serveFile(
          user,
          '../../../etc/passwd',
          '',
          mockRes() as unknown as Response,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when the file does not exist on disk', async () => {
      mockFs.access.mockRejectedValue(new Error('ENOENT'));
      await expect(
        controller.serveFile(
          user,
          'resumes/u-1/j-1/abc.pdf',
          '',
          mockRes() as unknown as Response,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when getFileInfo returns null (resume deleted)', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockService.getFileInfo.mockResolvedValue(null);

      await expect(
        controller.serveFile(
          user,
          'resumes/u-1/j-1/abc.pdf',
          '',
          mockRes() as unknown as Response,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the requested key is a stale/replaced storageKey', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockService.getFileInfo.mockResolvedValue({
        storageKey: 'resumes/u-1/j-1/new-current.pdf',
        originalName: resumeDto.originalName,
      });

      await expect(
        controller.serveFile(
          user,
          'resumes/u-1/j-1/abc.pdf',
          '',
          mockRes() as unknown as Response,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('sends the file inline when download param is absent', async () => {
      mockFs.access.mockResolvedValue(undefined);
      const res = mockRes();

      await controller.serveFile(
        user,
        'resumes/u-1/j-1/abc.pdf',
        '',
        res as unknown as Response,
      );

      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'inline; filename="my%20resume.pdf"; filename*=UTF-8\'\'my%20resume.pdf',
      );
      expect(res.sendFile).toHaveBeenCalled();
    });

    it('sends the file as attachment when download=true', async () => {
      mockFs.access.mockResolvedValue(undefined);
      const res = mockRes();

      await controller.serveFile(
        user,
        'resumes/u-1/j-1/abc.pdf',
        'true',
        res as unknown as Response,
      );

      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="my%20resume.pdf"; filename*=UTF-8\'\'my%20resume.pdf',
      );
    });

    it('sets Content-Type to application/pdf', async () => {
      mockFs.access.mockResolvedValue(undefined);
      const res = mockRes();

      await controller.serveFile(
        user,
        'resumes/u-1/j-1/abc.pdf',
        '',
        res as unknown as Response,
      );

      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/pdf',
      );
    });
  });
});
