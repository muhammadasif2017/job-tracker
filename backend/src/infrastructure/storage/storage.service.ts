/**
 * Injection token for the storage backend. The interface has two
 * implementations and `StorageModule` picks one at startup from
 * `STORAGE_DRIVER`, so consumers inject this token rather than a concrete
 * class.
 */
export const STORAGE_SERVICE = 'STORAGE_SERVICE';

/**
 * The whole storage surface the app depends on. Keep it this small — every
 * method added here has to be implemented for both local disk and Oracle
 * Object Storage, whose capabilities do not overlap much.
 */
export interface IStorageService {
  /** Stores the buffer under `key`, replacing anything already there. */
  upload(key: string, buffer: Buffer, mimeType: string): Promise<void>;
  /**
   * Returns a URL the browser can fetch the file from. Only the Oracle driver
   * presigns; the local one answers with its own auth-gated route and ignores
   * the expiry.
   */
  getPresignedUrl(key: string, expiresIn?: number): Promise<string>;
  /** Removes the stored file. Callers delete best-effort, after the row. */
  delete(key: string): Promise<void>;
}
