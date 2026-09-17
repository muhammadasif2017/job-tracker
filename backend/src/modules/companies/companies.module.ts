import { Module } from '@nestjs/common';
import { CompaniesService } from './companies.service.js';
import { CompaniesImportService } from './companies-import.service.js';
import { CompaniesController } from './companies.controller.js';
import { CompanyEnrichmentModule } from './enrichment/company-enrichment.module.js';

/** Target companies: CRUD, CSV import and profile enrichment. */
@Module({
  imports: [CompanyEnrichmentModule],
  providers: [CompaniesService, CompaniesImportService],
  controllers: [CompaniesController],
  exports: [CompaniesService],
})
export class CompaniesModule {}
