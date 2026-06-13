export const STORAGE_SERVICE = 'STORAGE_SERVICE';

export interface IStorageService {
  upload(key: string, buffer: Buffer, mimeType: string): Promise<void>;
  getPresignedUrl(key: string, expiresIn?: number): Promise<string>;
  delete(key: string): Promise<void>;
}
