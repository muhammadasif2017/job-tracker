import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import {
  STORAGE_SERVICE,
  type IStorageService,
} from '../../infrastructure/storage/storage.service.js';
import type { ResumeResponseDto } from './dto/resume-response.dto.js';
import { appLogger } from '../../infrastructure/error-tracking/app-logger.helper.js';

/**
 * Presigned URL lifetime in seconds, used only to compute the `expiresAt`
 * returned to the client. It is not passed to the storage driver, so it must
 * match `OracleStorageService.getPresignedUrl`'s default `expiresIn` of 900.
 */
const PRESIGNED_URL_TTL = 900;

/**
 * One PDF per job, held in whichever storage driver is configured. Every
 * method scopes its query through the parent job's `userId`, so a resume
 * belonging to another user reads as absent.
 */
@Injectable()
export class ResumesService {
  private readonly logger = appLogger(ResumesService);

  constructor(
    private prisma: PrismaService,
    @Inject(STORAGE_SERVICE) private storage: IStorageService,
  ) {}

  /**
   * Strips the row down to what a client may see. `storageKey` in
   * particular never leaves the server — it is an internal address, and the
   * download route hands out a presigned URL instead.
   */
  private toDto({
    id,
    jobId,
    originalName,
    size,
    createdAt,
  }: {
    id: string;
    jobId: string;
    originalName: string;
    size: number;
    createdAt: Date;
  }): ResumeResponseDto {
    return { id, jobId, originalName, size, createdAt };
  }

  /**
   * Replaces the job's resume, or creates it the first time.
   *
   * Storage is written before the database on purpose: a dangling file is a
   * better failure than a row pointing at nothing, and the `catch` removes
   * that file if the upsert fails. The previous file is deleted only after
   * the upsert commits, so it stays downloadable until the new row is live.
   * The magic-number check is what stops a renamed non-PDF getting stored:
   * the multer mime type comes from the client and can claim anything.
   */
  async upload(
    userId: string,
    jobId: string,
    file: Express.Multer.File,
  ): Promise<ResumeResponseDto> {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, userId },
      select: { id: true, resume: { select: { id: true, storageKey: true } } },
    });
    if (!job) throw new NotFoundException('Job not found');

    if (file.buffer.subarray(0, 4).toString('ascii') !== '%PDF') {
      throw new UnprocessableEntityException('File must be a valid PDF');
    }

    const originalName = file.originalname
      .replace(/[/\\]/g, '_')
      .replace(/\0/g, '')
      .slice(0, 255);

    const key = `resumes/${userId}/${jobId}/${randomUUID()}.pdf`;
    const oldKey = job.resume?.storageKey ?? null;

    await this.storage.upload(key, file.buffer, file.mimetype);

    try {
      const resume = await this.prisma.resume.upsert({
        where: { jobId },
        create: {
          jobId,
          originalName,
          size: file.size,
          storageKey: key,
        },
        update: {
          originalName,
          size: file.size,
          storageKey: key,
        },
      });

      if (oldKey) {
        await this.storage
          .delete(oldKey)
          .catch((err: Error) =>
            this.logger.warn({ err }, 'Failed to delete old resume key'),
          );
      }

      return this.toDto(resume);
    } catch (err) {
      await this.storage.delete(key).catch(() => undefined);
      throw err;
    }
  }

  /**
   * Hands back a short-lived download URL plus the name to save it under.
   * The expiry is returned with it so the client can tell a stale URL from
   * a genuine failure. Under the local driver this is the backend's own
   * auth-gated file route rather than a real presigned URL.
   */
  async getPresignedUrl(
    userId: string,
    jobId: string,
  ): Promise<{ url: string; originalName: string; expiresAt: string }> {
    const resume = await this.prisma.resume.findFirst({
      where: { jobId, job: { userId } },
    });
    if (!resume) throw new NotFoundException('Resume not found');

    const url = await this.storage.getPresignedUrl(resume.storageKey);
    const expiresAt = new Date(
      Date.now() + PRESIGNED_URL_TTL * 1000,
    ).toISOString();
    return { url, originalName: resume.originalName, expiresAt };
  }

  /**
   * Returns the job's resume metadata — name, size, upload time — without
   * touching storage.
   */
  async findByJob(userId: string, jobId: string): Promise<ResumeResponseDto> {
    const resume = await this.prisma.resume.findFirst({
      where: { jobId, job: { userId } },
    });
    if (!resume) throw new NotFoundException('No resume found for this job');
    return this.toDto(resume);
  }

  /**
   * Internal use only, never sent to clients: lets the local-driver
   * file-serve endpoint confirm the requested storage key still matches the
   * job's current resume, so a stale key from a replaced or deleted file
   * cannot still be served.
   */
  async getFileInfo(
    userId: string,
    jobId: string,
  ): Promise<{ storageKey: string; originalName: string } | null> {
    const resume = await this.prisma.resume.findFirst({
      where: { jobId, job: { userId } },
      select: { storageKey: true, originalName: true },
    });
    return resume;
  }

  /**
   * Deletes the row first, then the file best-effort. A file that outlives
   * its row is unreachable and harmless; a row pointing at a deleted file
   * would break the download route.
   */
  async remove(userId: string, jobId: string): Promise<{ message: string }> {
    const resume = await this.prisma.resume.findFirst({
      where: { jobId, job: { userId } },
    });
    if (!resume) throw new NotFoundException('Resume not found');

    await this.prisma.resume.delete({ where: { id: resume.id } });

    await this.storage.delete(resume.storageKey).catch((err: unknown) =>
      this.logger.warn(
        {
          storageKey: resume.storageKey,
          err,
        },
        'Storage delete failed after resume remove',
      ),
    );

    return { message: 'Resume deleted' };
  }
}
