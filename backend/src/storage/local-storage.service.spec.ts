import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import { LocalStorageService } from './local-storage.service.js';

jest.mock('fs/promises');
const mockFs = fs as jest.Mocked<typeof fs>;

const mockConfig = {
  get: jest.fn((key: string, def?: string) =>
    key === 'BACKEND_URL' ? 'http://localhost:3001' : def,
  ),
};

describe('LocalStorageService', () => {
  let service: LocalStorageService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        LocalStorageService,
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    service = module.get(LocalStorageService);
  });

  describe('upload', () => {
    it('creates parent directories recursively before writing', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await service.upload(
        'resumes/u-1/j-1/abc.pdf',
        Buffer.from('pdf'),
        'application/pdf',
      );

      expect(mockFs.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('resumes'),
        { recursive: true },
      );
    });

    it('writes the buffer to disk at the keyed path', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      const buffer = Buffer.from('pdf-content');

      await service.upload(
        'resumes/u-1/j-1/abc.pdf',
        buffer,
        'application/pdf',
      );

      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('abc.pdf'),
        buffer,
      );
    });
  });

  describe('getPresignedUrl', () => {
    it('returns a URL pointing to the local file endpoint with encoded key', async () => {
      const url = await service.getPresignedUrl('resumes/u-1/j-1/abc.pdf');

      expect(url).toBe(
        'http://localhost:3001/jobs/resumes/file?key=resumes%2Fu-1%2Fj-1%2Fabc.pdf',
      );
    });

    it('uses the BACKEND_URL from config', async () => {
      const url = await service.getPresignedUrl('some/key.pdf');

      expect(url).toContain('http://localhost:3001');
    });

    it('ignores the expiresIn parameter (local URLs do not expire)', async () => {
      const url1 = await service.getPresignedUrl('some/key.pdf', 60);
      const url2 = await service.getPresignedUrl('some/key.pdf', 900);

      expect(url1).toBe(url2);
    });
  });

  describe('delete', () => {
    it('unlinks the file at the correct absolute path', async () => {
      mockFs.unlink.mockResolvedValue(undefined);

      await service.delete('resumes/u-1/j-1/abc.pdf');

      expect(mockFs.unlink).toHaveBeenCalledWith(
        expect.stringContaining('abc.pdf'),
      );
    });

    it('does not throw when the file is already gone', async () => {
      mockFs.unlink.mockRejectedValue(
        Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
      );

      await expect(
        service.delete('resumes/u-1/j-1/missing.pdf'),
      ).resolves.toBeUndefined();
    });
  });
});
