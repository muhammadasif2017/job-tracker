import { Module } from '@nestjs/common';
import { JobsService } from './jobs.service.js';
import { JobCompanyLinkService } from './job-company-link.service.js';
import { JobGhostingService } from './job-ghosting.service.js';
import { JobsController } from './jobs.controller.js';
import { CompanyEnrichmentModule } from '../companies/enrichment/company-enrichment.module.js';
import { TimelineSummaryModule } from '../timeline-summary/timeline-summary.module.js';

/** Job applications: CRUD. Stats and parsing live in their own modules. */
@Module({
  // CompanyEnrichmentModule:
  // JobCompanyLinkService.enqueueLinkedCompany() triggers company-scoped
  // enrichment for both create and update — see
  // docs/specs/company-fk-phase3b.md. TimelineSummaryModule: JobsService
  // (create/update) and JobGhostingService (markGhosted) trigger a
  // timeline-summary regen.
  imports: [CompanyEnrichmentModule, TimelineSummaryModule],
  providers: [JobsService, JobCompanyLinkService, JobGhostingService],
  controllers: [JobsController],
})
export class JobsModule {}
