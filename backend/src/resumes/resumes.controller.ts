import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Query,
  Res,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  MaxFileSizeValidator,
  FileTypeValidator,
  ParseFilePipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { Response } from 'express';
import { ResumesService } from './resumes.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8 MB

@Controller('jobs')
export class ResumesController {
  private readonly uploadsDir = path.resolve(process.cwd(), 'uploads');

  constructor(
    private resumesService: ResumesService,
    private config: ConfigService,
  ) {}

  @Post(':jobId/resumes')
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE },
    }),
  )
  uploadResume(
    @CurrentUser() user: { id: string },
    @Param('jobId') jobId: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: MAX_FILE_SIZE }),
          new FileTypeValidator({ fileType: 'application/pdf' }),
        ],
        errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      }),
    )
    file: Express.Multer.File,
  ) {
    return this.resumesService.upload(user.id, jobId, file);
  }

  @Get(':jobId/resumes/url')
  getPresignedUrl(
    @CurrentUser() user: { id: string },
    @Param('jobId') jobId: string,
  ) {
    return this.resumesService.getPresignedUrl(user.id, jobId);
  }

  @Get(':jobId/resumes')
  findByJob(
    @CurrentUser() user: { id: string },
    @Param('jobId') jobId: string,
  ) {
    return this.resumesService.findByJob(user.id, jobId);
  }

  @Delete(':jobId/resumes')
  @HttpCode(HttpStatus.OK)
  remove(@CurrentUser() user: { id: string }, @Param('jobId') jobId: string) {
    return this.resumesService.remove(user.id, jobId);
  }

  // Dev-only: serves files stored by LocalStorageService.
  // In production (STORAGE_DRIVER=oracle) clients use presigned URLs instead.
  // Auth derives userId from the key format (resumes/<userId>/...) and compares
  // it against @CurrentUser() — if the key format ever changes, update this check.
  @Get('resumes/file')
  async serveFile(
    @CurrentUser() user: { id: string },
    @Query('key') key: string,
    @Query('download') download: string,
    @Res() res: Response,
  ) {
    if (this.config.get('STORAGE_DRIVER') === 'oracle') {
      throw new NotFoundException();
    }
    if (!key) throw new BadRequestException('Missing key');

    // Prevent path traversal: resolve and verify it stays inside uploadsDir
    const filePath = path.resolve(this.uploadsDir, key);
    if (!filePath.startsWith(this.uploadsDir + path.sep)) {
      throw new BadRequestException('Invalid key');
    }

    // Key format: resumes/<userId>/<jobId>/<uuid>.pdf
    // Validate all segments explicitly — positional split is fragile if format changes.
    const parts = key.split('/');
    if (parts.length !== 4 || parts[0] !== 'resumes') {
      throw new BadRequestException('Invalid key format');
    }
    const [, keyUserId, jobId] = parts;
    if (keyUserId !== user.id) {
      throw new ForbiddenException('Access denied to this file');
    }

    try {
      await fs.access(filePath);
    } catch {
      throw new NotFoundException('File not found');
    }

    const resume = await this.resumesService.findByJob(user.id, jobId);
    if (!resume) throw new NotFoundException('File not found');

    const disposition = download === 'true' ? 'attachment' : 'inline';
    const safeName = encodeURIComponent(resume.originalName);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${safeName}"; filename*=UTF-8''${safeName}`,
    );
    res.sendFile(filePath);
  }
}
