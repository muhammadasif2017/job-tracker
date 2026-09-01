import { Module } from '@nestjs/common';
import { JobsService } from './jobs.service.js';
import { JobsStatsService } from './jobs-stats.service.js';
import { JobParsingService } from './job-parsing.service.js';
import { JobsController } from './jobs.controller.js';
import { EnrichmentModule } from '../enrichment/enrichment.module.js';
import { CompanyEnrichmentModule } from '../companies/enrichment/company-enrichment.module.js';
import { TimelineSummaryModule } from '../timeline-summary/timeline-summary.module.js';

@Module({
  // EnrichmentModule: JobParsingService uses its WebFetch/Search/Llm
  // services directly (for POST /jobs/parse). CompanyEnrichmentModule:
  // JobsService.create() triggers company-scoped enrichment — see
  // docs/specs/company-fk-phase3b.md. TimelineSummaryModule: JobsService
  // triggers a timeline-summary regen on create/status-change.
  imports: [EnrichmentModule, CompanyEnrichmentModule, TimelineSummaryModule],
  providers: [JobsService, JobsStatsService, JobParsingService],
  controllers: [JobsController],
})
export class JobsModule {}
