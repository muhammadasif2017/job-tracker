import { Module } from '@nestjs/common';
import { JobParsingService } from './job-parsing.service.js';
import { JobParsingController } from './job-parsing.controller.js';
import { EnrichmentModule } from '../enrichment/enrichment.module.js';

/**
 * Quick Add's posting parser, mounted under `jobs` but owned separately from
 * JobsModule. EnrichmentModule: JobParsingService uses its WebFetch/Search/Llm
 * services directly (for POST /jobs/parse) — it is the only consumer of them
 * outside CompanyEnrichmentModule, which is why JobsModule no longer imports
 * EnrichmentModule at all.
 */
@Module({
  imports: [EnrichmentModule],
  providers: [JobParsingService],
  controllers: [JobParsingController],
})
export class JobParsingModule {}
