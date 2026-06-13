import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { IStorageService } from './storage.service.js';

@Injectable()
export class OracleStorageService implements IStorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    this.bucket = config.getOrThrow<string>('OCI_BUCKET_NAME');
    const namespace = config.getOrThrow<string>('OCI_NAMESPACE');
    const region = config.getOrThrow<string>('OCI_REGION');

    this.client = new S3Client({
      region,
      endpoint: `https://${namespace}.compat.objectstorage.${region}.oraclecloud.com`,
      credentials: {
        accessKeyId: config.getOrThrow<string>('OCI_ACCESS_KEY_ID'),
        secretAccessKey: config.getOrThrow<string>('OCI_SECRET_ACCESS_KEY'),
      },
      forcePathStyle: true,
      // OCI's S3-compatible API can't verify the SDK's default CRC32 streaming
      // checksums and returns a misleading SignatureDoesNotMatch error. Only
      // send checksums when an operation strictly requires them.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  async upload(key: string, buffer: Buffer, mimeType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      }),
    );
  }

  async getPresignedUrl(key: string, expiresIn = 900): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn },
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}
