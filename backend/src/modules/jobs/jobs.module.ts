import { Module } from '@nestjs/common';
import { JobsService } from './jobs.service.js';
import { JobsController } from './jobs.controller.js';
import { EnrichmentModule } from '../enrichment/enrichment.module.js';

@Module({
  imports: [EnrichmentModule],
  providers: [JobsService],
  controllers: [JobsController],
})
export class JobsModule {}
