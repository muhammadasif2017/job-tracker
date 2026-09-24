import { Module } from '@nestjs/common';
import { CompaniesService } from './companies.service.js';
import { CompaniesImportService } from './companies-import.service.js';
import { CompanyDedupService } from './company-dedup.service.js';
import { CompaniesController } from './companies.controller.js';
import { CompanyEnrichmentModule } from './enrichment/company-enrichment.module.js';

/** Target companies: CRUD, CSV import, profile enrichment and deduplication. */
@Module({
  imports: [CompanyEnrichmentModule],
  providers: [CompaniesService, CompaniesImportService, CompanyDedupService],
  controllers: [CompaniesController],
  exports: [CompaniesService],
})
export class CompaniesModule {}
