import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EnrichmentModule } from '../enrichment/enrichment.module.js';
import { TimelineSummaryService } from './timeline-summary.service.js';
import { TimelineSummaryProcessor } from './timeline-summary.processor.js';
import { JOB_TIMELINE_SUMMARY_QUEUE } from './timeline-summary.constants.js';

@Module({
  imports: [
    BullModule.registerQueue({ name: JOB_TIMELINE_SUMMARY_QUEUE }),
    EnrichmentModule,
  ],
  providers: [TimelineSummaryService, TimelineSummaryProcessor],
  exports: [TimelineSummaryService],
})
export class TimelineSummaryModule {}
