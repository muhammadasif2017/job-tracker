import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiConsumes,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiAcceptedResponse,
  ApiNotFoundResponse,
  ApiConflictResponse,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CompaniesService } from './companies.service.js';
import { CompaniesImportService } from './companies-import.service.js';
import { CreateCompanyDto } from './dto/create-company.dto.js';
import { UpdateCompanyDto } from './dto/update-company.dto.js';
import { CompanyQueryDto } from './dto/company-query.dto.js';
import { MergeCompanyDto } from './dto/merge-company.dto.js';
import { CompanyResponseDto } from './dto/company-response.dto.js';
import { DuplicateSuggestionDto } from './dto/duplicate-suggestion.dto.js';
import { PaginatedCompaniesDto } from './dto/paginated-companies.dto.js';
import { CsvImportResultDto } from './dto/csv-import-result.dto.js';
import { CompanyApplicationHistoryQueryDto } from './dto/company-application-history-query.dto.js';
import { CompanyApplicationHistoryDto } from './dto/company-application-history.dto.js';
import { MessageDto } from '../../common/dto/message.dto.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';

// CSV of company names is tiny — 1 MB comfortably covers a large import
// while still rejecting an accidentally-wrong file upload early.
const MAX_CSV_SIZE = 1 * 1024 * 1024;

/**
 * Target companies: the list the user curates, plus enrichment, merging,
 * duplicate detection and CSV import. Route order matters here — the
 * literal routes are declared before `:id` so their names are not captured
 * as an id.
 */
@ApiTags('companies')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@Controller('companies')
export class CompaniesController {
  constructor(
    private companiesService: CompaniesService,
    private companiesImport: CompaniesImportService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Add a target company' })
  @ApiCreatedResponse({ type: CompanyResponseDto })
  @ApiBadRequestResponse({ description: 'Company limit reached' })
  @ApiConflictResponse({
    description: 'A company with this name already exists',
  })
  /** Adds a target company and queues enrichment for it. */
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateCompanyDto) {
    return this.companiesService.create(user.id, dto);
  }

  /** Lists the user's companies, paginated and filterable. */
  @Get()
  @ApiOperation({ summary: 'List target companies (filter by city, priority)' })
  @ApiOkResponse({ type: PaginatedCompaniesDto })
  findAll(
    @CurrentUser() user: { id: string },
    @Query() query: CompanyQueryDto,
  ) {
    return this.companiesService.findAll(user.id, query);
  }

  @Get('duplicates')
  @ApiOperation({
    summary:
      'Find likely-duplicate company pairs (websiteUrl match or fuzzy name match)',
  })
  /**
   * Suggests likely duplicate pairs.
   *
   * Registered before `GET :id`, or "duplicates" would be captured as an
   * id. The scan is quadratic over the user's own companies, but this route
   * deliberately carries no per-route throttle: unlike the import below, it
   * is fetched passively on every companies-page mount, and a 10/min cap
   * broke ordinary navigation in e2e. The per-user company cap already
   * bounds the worst case, so the generic guard is enough.
   */
  @ApiOkResponse({ type: DuplicateSuggestionDto, isArray: true })
  findDuplicates(@CurrentUser() user: { id: string }) {
    return this.companiesService.findDuplicateSuggestions(user.id);
  }

  @Get('application-history')
  @ApiOperation({
    summary:
      'Past applications to a company, by case-insensitive name (job-create confirm)',
  })
  /**
   * Answers whether the user has applied at a company with this name
   * before. Declared before `GET :id` for the same reason as the duplicates
   * route.
   */
  @ApiOkResponse({ type: CompanyApplicationHistoryDto })
  findApplicationHistory(
    @CurrentUser() user: { id: string },
    @Query() query: CompanyApplicationHistoryQueryDto,
  ) {
    return this.companiesService.findApplicationHistory(user.id, query.name);
  }

  /** Returns one company with its contacts and linked jobs. */
  @Get(':id')
  @ApiOperation({ summary: 'Get a target company' })
  @ApiParam({ name: 'id', description: 'Company ID' })
  @ApiOkResponse({ type: CompanyResponseDto })
  @ApiNotFoundResponse({ description: 'Company not found' })
  findOne(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.companiesService.findOne(user.id, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a target company' })
  @ApiParam({ name: 'id', description: 'Company ID' })
  @ApiOkResponse({ type: CompanyResponseDto })
  @ApiNotFoundResponse({ description: 'Company not found' })
  @ApiConflictResponse({
    description: 'A company with this name already exists',
  })
  /** Edits a company. */
  update(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: UpdateCompanyDto,
  ) {
    return this.companiesService.update(user.id, id, dto);
  }

  /** Deletes a company. */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a target company' })
  @ApiParam({ name: 'id', description: 'Company ID' })
  @ApiOkResponse({ type: MessageDto })
  @ApiNotFoundResponse({ description: 'Company not found' })
  remove(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.companiesService.remove(user.id, id);
  }

  /**
   * Queues an enrichment run — the Refresh button. Throttled for the same
   * reason as job parsing: each call costs a web search and a model round
   * trip. Answers 202, not 200: the work happens on the queue, and the
   * profile updates when it lands.
   */
  @Post(':id/enrichment')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'Queue AI company research for a target company' })
  @ApiParam({ name: 'id', description: 'Company ID' })
  @ApiAcceptedResponse({ type: MessageDto, description: 'Enrichment queued' })
  @ApiNotFoundResponse({ description: 'Company not found' })
  @ApiConflictResponse({ description: 'Enrichment already in progress' })
  triggerEnrichment(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    return this.companiesService.triggerEnrichment(user.id, id);
  }

  @Post(':id/merge')
  @ApiOperation({
    summary:
      'Merge a duplicate company into this one — reassigns its jobs and contacts, then deletes it',
  })
  @ApiParam({
    name: 'id',
    description: 'Canonical company ID (survives the merge)',
  })
  @ApiOkResponse({ type: CompanyResponseDto })
  @ApiNotFoundResponse({
    description: 'Canonical or duplicate company not found',
  })
  /**
   * Merges a duplicate into this company, reassigning the duplicate's jobs
   * and contacts before deleting it. The surviving company is the one named
   * in the path.
   */
  @ApiConflictResponse({ description: 'Cannot merge a company with itself' })
  merge(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: MergeCompanyDto,
  ) {
    return this.companiesService.mergeCompanies(
      user.id,
      id,
      dto.duplicateCompanyId,
      dto.fieldOverrides,
    );
  }

  @Post('import')
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_CSV_SIZE },
    }),
  )
  @ApiOperation({
    summary: 'Bulk-import target companies from a CSV (name,city,businessMode)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description:
            'CSV file, header row "name,city,businessMode" (max 1 MB)',
        },
      },
    },
  })
  /**
   * Bulk-imports companies from a CSV. Throttled like the other costly
   * routes, and always answers with a per-row result — a file can import
   * partially, with the rejected rows reported back by line number.
   *
   * The leading byte-order mark that Excel and Google Sheets prepend is
   * stripped here, or it would land inside the first header cell and fail
   * validation on an otherwise valid file. It is compared by code point so
   * the character itself never appears raw in this source.
   */
  @ApiCreatedResponse({ type: CsvImportResultDto })
  importCsv(
    @CurrentUser() user: { id: string },
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: MAX_CSV_SIZE })],
      }),
    )
    file: Express.Multer.File,
  ) {
    // Excel/Google Sheets CSV exports commonly prepend a UTF-8 BOM (U+FEFF),
    // which would otherwise land inside the first header cell and fail
    // header validation on an otherwise-valid file. Compared by code point
    // (not a regex literal) so the BOM itself never appears as a raw
    // character in source.
    const raw = file.buffer.toString('utf-8');
    const content = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    return this.companiesImport.import(user.id, content);
  }
}
