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
  NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  MaxFileSizeValidator,
  FileTypeValidator,
  ParseFilePipe,
} from '@nestjs/common';
import { memoryStorage } from 'multer';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { Response } from 'express';
import { ResumesService } from './resumes.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';

const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8 MB

@Controller('resumes')
export class ResumesController {
  private readonly uploadsDir = path.resolve(process.cwd(), 'uploads');

  constructor(private resumesService: ResumesService) {}

  @Post('jobs/:jobId')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
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

  @Get('jobs/:jobId/url')
  getPresignedUrl(
    @CurrentUser() user: { id: string },
    @Param('jobId') jobId: string,
  ) {
    return this.resumesService.getPresignedUrl(user.id, jobId);
  }

  @Get('jobs/:jobId')
  findByJob(
    @CurrentUser() user: { id: string },
    @Param('jobId') jobId: string,
  ) {
    return this.resumesService.findByJob(user.id, jobId);
  }

  @Delete('jobs/:jobId')
  @HttpCode(HttpStatus.OK)
  remove(@CurrentUser() user: { id: string }, @Param('jobId') jobId: string) {
    return this.resumesService.remove(user.id, jobId);
  }

  // Dev-only: serves files stored by LocalStorageService.
  // In production STORAGE_DRIVER=oracle so this path is never used.
  @Public()
  @Get('file')
  async serveFile(
    @Query('key') key: string,
    @Query('download') download: string,
    @Res() res: Response,
  ) {
    if (process.env.STORAGE_DRIVER === 'oracle') {
      throw new NotFoundException();
    }
    if (!key) throw new BadRequestException('Missing key');

    // Prevent path traversal: resolve and verify it stays inside uploadsDir
    const filePath = path.resolve(this.uploadsDir, key);
    if (!filePath.startsWith(this.uploadsDir + path.sep)) {
      throw new BadRequestException('Invalid key');
    }

    try {
      await fs.access(filePath);
    } catch {
      throw new NotFoundException('File not found');
    }

    const disposition = download === 'true' ? 'attachment' : 'inline';
    const filename = path.basename(filePath);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${filename}"`,
    );
    res.sendFile(filePath);
  }
}
