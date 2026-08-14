import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  MaxFileSizeValidator,
  NotFoundException,
  Param,
  ParseFilePipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { EnrichmentStatus } from '@prisma/client';
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
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CompaniesService } from './companies.service.js';
import { CompaniesImportService } from './companies-import.service.js';
import { CreateCompanyDto } from './dto/create-company.dto.js';
import { UpdateCompanyDto } from './dto/update-company.dto.js';
import { CompanyQueryDto } from './dto/company-query.dto.js';
import { CompanyResponseDto } from './dto/company-response.dto.js';
import { PaginatedCompaniesDto } from './dto/paginated-companies.dto.js';
import { CsvImportResultDto } from './dto/csv-import-result.dto.js';
import { MessageDto } from '../../common/dto/message.dto.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CompanyEnrichmentService } from './enrichment/company-enrichment.service.js';

// CSV of company names is tiny — 1 MB comfortably covers a large import
// while still rejecting an accidentally-wrong file upload early.
const MAX_CSV_SIZE = 1 * 1024 * 1024;

@ApiTags('companies')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@Controller('companies')
export class CompaniesController {
  constructor(
    private companiesService: CompaniesService,
    private companiesImport: CompaniesImportService,
    private prisma: PrismaService,
    private companyEnrichment: CompanyEnrichmentService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Add a target company' })
  @ApiCreatedResponse({ type: CompanyResponseDto })
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateCompanyDto) {
    return this.companiesService.create(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List target companies (filter by city, priority)' })
  @ApiOkResponse({ type: PaginatedCompaniesDto })
  findAll(
    @CurrentUser() user: { id: string },
    @Query() query: CompanyQueryDto,
  ) {
    return this.companiesService.findAll(user.id, query);
  }

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
  update(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: UpdateCompanyDto,
  ) {
    return this.companiesService.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a target company' })
  @ApiParam({ name: 'id', description: 'Company ID' })
  @ApiOkResponse({ type: MessageDto })
  @ApiNotFoundResponse({ description: 'Company not found' })
  remove(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.companiesService.remove(user.id, id);
  }

  @Post(':id/enrichment')
  @HttpCode(HttpStatus.ACCEPTED)
  // Same external-cost rationale as POST /jobs/parse — a Tavily search +
  // Groq LLM round trip per call.
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'Queue AI company research for a target company' })
  @ApiParam({ name: 'id', description: 'Company ID' })
  @ApiAcceptedResponse({ description: 'Enrichment queued' })
  @ApiNotFoundResponse({ description: 'Company not found' })
  @ApiConflictResponse({ description: 'Enrichment already in progress' })
  async triggerEnrichment(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    const company = await this.prisma.company.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    });
    if (!company) throw new NotFoundException('Company not found');

    // CAS: claim the row by flipping status to PENDING only if it isn't
    // already PENDING/PROCESSING, closing the TOCTOU window where two
    // concurrent requests both read a non-busy status and both enqueue.
    const { count } = await this.prisma.company.updateMany({
      where: {
        id,
        OR: [
          { status: null },
          {
            status: {
              notIn: [EnrichmentStatus.PENDING, EnrichmentStatus.PROCESSING],
            },
          },
        ],
      },
      data: { status: EnrichmentStatus.PENDING, errorMessage: null },
    });
    if (count === 0) {
      throw new ConflictException('Enrichment already in progress');
    }

    await this.companyEnrichment.enqueueEnrichment(id);
    return { message: 'Enrichment queued' };
  }

  @Post('import')
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
    return this.companiesImport.import(user.id, file.buffer.toString('utf-8'));
  }
}
