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
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiConsumes,
  ApiBody,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import { ResumesService } from './resumes.service.js';
import { ResumeResponseDto } from './dto/resume-response.dto.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';

const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8 MB

/**
 * Resume upload and download, nested under the owning job. Which routes are
 * usable depends on the configured storage driver: `resumes/url` is the
 * production path and `resumes/file` the local-disk one.
 */
@ApiTags('jobs')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
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
  @ApiOperation({ summary: 'Upload or replace a resume PDF for a job' })
  @ApiParam({ name: 'jobId', description: 'Job ID' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'PDF file (max 8 MB)',
        },
      },
      required: ['file'],
    },
  })
  /**
   * Uploads or replaces the job's resume. The file is held in memory rather
   * than spooled to disk — the size cap is small and the service hands the
   * buffer straight to the storage driver. Two validations run before the
   * service sees it: the declared size and mime type here, then a
   * magic-number check in the service that the client cannot influence.
   */
  @ApiCreatedResponse({ type: ResumeResponseDto })
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
  @ApiOperation({
    summary: 'Get a presigned URL to download the resume (oracle driver only)',
  })
  /**
   * Returns a short-lived download URL for the resume. The production
   * download path: the client fetches the file from object storage directly
   * and the backend never proxies its bytes.
   */
  @ApiParam({ name: 'jobId', description: 'Job ID' })
  @ApiOkResponse({ description: 'Returns presigned URL' })
  @ApiNotFoundResponse({ description: 'No resume found for this job' })
  getPresignedUrl(
    @CurrentUser() user: { id: string },
    @Param('jobId') jobId: string,
  ) {
    return this.resumesService.getPresignedUrl(user.id, jobId);
  }

  /** Returns the resume's metadata, or 404 when the job has none. */
  @Get(':jobId/resumes')
  @ApiOperation({ summary: 'Get resume metadata for a job' })
  @ApiParam({ name: 'jobId', description: 'Job ID' })
  @ApiOkResponse({ type: ResumeResponseDto })
  @ApiNotFoundResponse({ description: 'No resume found for this job' })
  findByJob(
    @CurrentUser() user: { id: string },
    @Param('jobId') jobId: string,
  ) {
    return this.resumesService.findByJob(user.id, jobId);
  }

  /** Deletes the job's resume. */
  @Delete(':jobId/resumes')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete the resume for a job' })
  @ApiParam({ name: 'jobId', description: 'Job ID' })
  @ApiOkResponse({ description: 'Resume deleted' })
  @ApiNotFoundResponse({ description: 'No resume found for this job' })
  remove(@CurrentUser() user: { id: string }, @Param('jobId') jobId: string) {
    return this.resumesService.remove(user.id, jobId);
  }

  @Get('resumes/file')
  @ApiOperation({
    summary: 'Serve a resume file by storage key (local driver only)',
  })
  @ApiQuery({
    name: 'key',
    required: true,
    description: 'Storage key (resumes/<userId>/<jobId>/<uuid>.pdf)',
  })
  @ApiQuery({
    name: 'download',
    required: false,
    description: 'Set to "true" for attachment disposition',
  })
  @ApiOkResponse({
    description: 'PDF file stream',
    content: { 'application/pdf': {} },
  })
  @ApiForbiddenResponse({ description: 'Key belongs to another user' })
  @ApiNotFoundResponse({
    description: 'File not found or oracle driver active',
  })
  /**
   * Serves a stored file by key, for the local driver only; with
   * `STORAGE_DRIVER=oracle` it answers 404 and clients use presigned URLs
   * instead.
   *
   * This is the one route that takes a storage key from the client, so it
   * re-checks everything: the resolved path must stay inside the uploads
   * directory, the key must have the exact
   * `resumes/<userId>/<jobId>/<uuid>.pdf` shape, its user segment must
   * match the caller, and the key must still be the job's current resume —
   * otherwise a key kept from a replaced file would go on being served. If
   * that key format ever changes, this check has to change with it.
   */
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

    const fileInfo = await this.resumesService.getFileInfo(user.id, jobId);
    if (!fileInfo || fileInfo.storageKey !== key) {
      throw new NotFoundException('File not found');
    }

    const disposition = download === 'true' ? 'attachment' : 'inline';
    const safeName = encodeURIComponent(fileInfo.originalName);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${safeName}"; filename*=UTF-8''${safeName}`,
    );
    res.sendFile(filePath);
  }
}
