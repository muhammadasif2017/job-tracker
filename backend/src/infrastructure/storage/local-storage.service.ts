import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { IStorageService } from './storage.service.js';
import { CURRENT_API_PREFIX } from '../../config/api-versioning.helper.js';

/**
 * The dev driver: files live under `backend/uploads/` and are served back
 * through an auth-gated backend route. Not used in production —
 * `OracleStorageService` is.
 */
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

  /**
   * Writes the file to disk, creating the key's parent directories. The
   * mime type is ignored: on disk the extension in the key carries it.
   */
  async upload(key: string, buffer: Buffer, _mimeType: string): Promise<void> {
    const filePath = path.join(this.uploadsDir, key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer);
  }

  /**
   * There is nothing to presign locally, so this returns the backend's own
   * file-serving route. That route is auth-gated, which is why the expiry
   * argument is ignored rather than approximated.
   */
  getPresignedUrl(key: string, _expiresIn?: number): Promise<string> {
    return Promise.resolve(
      `${this.backendUrl}${CURRENT_API_PREFIX}/jobs/resumes/file?key=${encodeURIComponent(key)}`,
    );
  }

  /**
   * Deletes the file, treating a missing one as success — callers delete
   * best-effort after the database row is already gone.
   */
  async delete(key: string): Promise<void> {
    const filePath = path.join(this.uploadsDir, key);
    await fs.unlink(filePath).catch(() => undefined);
  }
}
