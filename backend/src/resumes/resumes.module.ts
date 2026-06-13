import { Module } from '@nestjs/common';
import { ResumesService } from './resumes.service.js';
import { ResumesController } from './resumes.controller.js';

@Module({
  providers: [ResumesService],
  controllers: [ResumesController],
  exports: [ResumesService],
})
export class ResumesModule {}
