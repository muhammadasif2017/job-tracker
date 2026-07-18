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
  @ApiParam({ name: 'jobId', description: 'Job ID' })
  @ApiOkResponse({ description: 'Returns presigned URL' })
  @ApiNotFoundResponse({ description: 'No resume found for this job' })
  getPresignedUrl(
    @CurrentUser() user: { id: string },
    @Param('jobId') jobId: string,
  ) {
    return this.resumesService.getPresignedUrl(user.id, jobId);
  }

  @Get(':jobId/resumes')
  @ApiOperation({ summary: 'Get resume metadata for a job' })
  @ApiParam({ name: 'jobId', description: 'Job ID' })
  @ApiOkResponse({ type: ResumeResponseDto })
  findByJob(
    @CurrentUser() user: { id: string },
    @Param('jobId') jobId: string,
  ) {
    return this.resumesService.findByJob(user.id, jobId);
  }

  @Delete(':jobId/resumes')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete the resume for a job' })
  @ApiParam({ name: 'jobId', description: 'Job ID' })
  @ApiOkResponse({ description: 'Resume deleted' })
  @ApiNotFoundResponse({ description: 'No resume found for this job' })
  remove(@CurrentUser() user: { id: string }, @Param('jobId') jobId: string) {
    return this.resumesService.remove(user.id, jobId);
  }

  // Dev-only: serves files stored by LocalStorageService.
  // In production (STORAGE_DRIVER=oracle) clients use presigned URLs instead.
  // Auth derives userId from the key format (resumes/<userId>/...) and compares
  // it against @CurrentUser() — if the key format ever changes, update this check.
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
