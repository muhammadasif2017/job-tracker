import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EnrichmentService } from './enrichment.service.js';
import {
  EnrichmentProcessor,
  ENRICHMENT_QUEUE,
} from './enrichment.processor.js';
import { WebFetchService } from './services/web-fetch.service.js';
import { SearchService } from './services/search.service.js';
import { LlmService } from './services/llm.service.js';

@Module({
  imports: [BullModule.registerQueue({ name: ENRICHMENT_QUEUE })],
  providers: [
    EnrichmentService,
    EnrichmentProcessor,
    WebFetchService,
    SearchService,
    LlmService,
  ],
  exports: [EnrichmentService],
})
export class EnrichmentModule {}
