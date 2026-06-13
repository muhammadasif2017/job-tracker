import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Logger } from 'nestjs-pino';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  STORAGE_SERVICE,
  type IStorageService,
} from '../storage/storage.service.js';
import type { ResumeResponseDto } from './dto/resume-response.dto.js';

@Injectable()
export class ResumesService {
  constructor(
    private prisma: PrismaService,
    @Inject(STORAGE_SERVICE) private storage: IStorageService,
    private logger: Logger,
  ) {}

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

    const key = `resumes/${userId}/${jobId}/${randomUUID()}.pdf`;
    const oldKey = job.resume?.storageKey ?? null;

    await this.storage.upload(key, file.buffer, file.mimetype);

    try {
      const resume = await this.prisma.resume.upsert({
        where: { jobId },
        create: {
          jobId,
          originalName: file.originalname,
          size: file.size,
          storageKey: key,
        },
        update: {
          originalName: file.originalname,
          size: file.size,
          storageKey: key,
        },
      });

      if (oldKey) {
        await this.storage.delete(oldKey).catch(() => undefined);
      }

      return this.toDto(resume);
    } catch (err) {
      await this.storage.delete(key).catch(() => undefined);
      throw err;
    }
  }

  async getPresignedUrl(
    userId: string,
    jobId: string,
  ): Promise<{ url: string; originalName: string }> {
    const resume = await this.prisma.resume.findFirst({
      where: { jobId, job: { userId } },
    });
    if (!resume) throw new NotFoundException('Resume not found');

    const url = await this.storage.getPresignedUrl(resume.storageKey);
    return { url, originalName: resume.originalName };
  }

  async findByJob(
    userId: string,
    jobId: string,
  ): Promise<ResumeResponseDto | null> {
    const resume = await this.prisma.resume.findFirst({
      where: { jobId, job: { userId } },
    });
    return resume ? this.toDto(resume) : null;
  }

  async remove(userId: string, jobId: string): Promise<{ message: string }> {
    const resume = await this.prisma.resume.findFirst({
      where: { jobId, job: { userId } },
    });
    if (!resume) throw new NotFoundException('Resume not found');

    await this.prisma.resume.delete({ where: { id: resume.id } });

    await this.storage.delete(resume.storageKey).catch((err: unknown) =>
      this.logger.warn('Storage delete failed after resume remove', {
        storageKey: resume.storageKey,
        err,
      }),
    );

    return { message: 'Resume deleted' };
  }
}
