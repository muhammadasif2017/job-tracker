import { Module } from '@nestjs/common';
import { InterviewRoundsService } from './interview-rounds.service.js';
import { InterviewRoundsController } from './interview-rounds.controller.js';
import { EnrichmentModule } from '../enrichment/enrichment.module.js';
import { TimelineSummaryModule } from '../timeline-summary/timeline-summary.module.js';

@Module({
  // EnrichmentModule: generates next-round prep suggestions from a debrief
  // (LlmService.generateRoundPrep). TimelineSummaryModule: logRoundEvent
  // writes JobEvents, which should trigger a timeline-summary regen too.
  imports: [EnrichmentModule, TimelineSummaryModule],
  providers: [InterviewRoundsService],
  controllers: [InterviewRoundsController],
})
export class InterviewRoundsModule {}
