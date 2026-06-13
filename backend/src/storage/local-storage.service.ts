import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { IStorageService } from './storage.service.js';

@Injectable()
export class LocalStorageService implements IStorageService {
  private readonly uploadsDir: string;
  private readonly backendUrl: string;

  constructor(private readonly config: ConfigService) {
    this.uploadsDir = path.resolve(process.cwd(), 'uploads');
    this.backendUrl = config.get<string>(
      'BACKEND_URL',
      'http://localhost:3001',
    );
  }

  async upload(key: string, buffer: Buffer, _mimeType: string): Promise<void> {
    const filePath = path.join(this.uploadsDir, key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer);
  }

  getPresignedUrl(key: string, _expiresIn?: number): Promise<string> {
    return Promise.resolve(
      `${this.backendUrl}/jobs/resumes/file?key=${encodeURIComponent(key)}`,
    );
  }

  async delete(key: string): Promise<void> {
    const filePath = path.join(this.uploadsDir, key);
    await fs.unlink(filePath).catch(() => undefined);
  }
}
