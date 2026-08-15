import { Module } from '@nestjs/common';
import { WebFetchService } from './services/web-fetch.service.js';
import { SearchService } from './services/search.service.js';
import { LlmService } from './services/llm.service.js';

// Job-scoped enrichment (EnrichmentService/EnrichmentProcessor/
// EnrichmentController, writing to CompanyProfile) was removed here — job
// creation now triggers company-scoped enrichment instead (see
// CompanyEnrichmentModule, docs/specs/company-fk-phase3b.md). This module
// now only provides the shared extraction services both
// CompanyEnrichmentModule and JobParsingService depend on directly.
@Module({
  providers: [WebFetchService, SearchService, LlmService],
  exports: [WebFetchService, SearchService, LlmService],
})
export class EnrichmentModule {}
