import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EnrichmentModule } from '../../enrichment/enrichment.module.js';
import { CompanyEnrichmentService } from './company-enrichment.service.js';
import { CompanyEnrichmentProcessor } from './company-enrichment.processor.js';
import { COMPANY_ENRICHMENT_QUEUE } from './company-enrichment.constants.js';

@Module({
  imports: [
    BullModule.registerQueue({ name: COMPANY_ENRICHMENT_QUEUE }),
    EnrichmentModule,
  ],
  providers: [CompanyEnrichmentService, CompanyEnrichmentProcessor],
  exports: [CompanyEnrichmentService],
})
export class CompanyEnrichmentModule {}
