import { Module } from '@nestjs/common';
import { JobsService } from './jobs.service.js';
import { JobsStatsService } from './jobs-stats.service.js';
import { JobParsingService } from './job-parsing.service.js';
import { JobCompanyLinkService } from './job-company-link.service.js';
import { JobGhostingService } from './job-ghosting.service.js';
import { JobsController } from './jobs.controller.js';
import { EnrichmentModule } from '../enrichment/enrichment.module.js';
import { CompanyEnrichmentModule } from '../companies/enrichment/company-enrichment.module.js';
import { TimelineSummaryModule } from '../timeline-summary/timeline-summary.module.js';

/** Job applications: CRUD, stats and parsing a posting into a job. */
@Module({
  // EnrichmentModule: JobParsingService uses its WebFetch/Search/Llm
  // services directly (for POST /jobs/parse). CompanyEnrichmentModule:
  // JobCompanyLinkService.enqueueLinkedCompany() triggers company-scoped
  // enrichment for both create and update — see
  // docs/specs/company-fk-phase3b.md. TimelineSummaryModule: JobsService
  // (create/update) and JobGhostingService (markGhosted) trigger a
  // timeline-summary regen.
  imports: [EnrichmentModule, CompanyEnrichmentModule, TimelineSummaryModule],
  providers: [
    JobsService,
    JobsStatsService,
    JobParsingService,
    JobCompanyLinkService,
    JobGhostingService,
  ],
  controllers: [JobsController],
})
export class JobsModule {}
