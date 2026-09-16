import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiNotFoundResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ContactsService } from './contacts.service.js';
import { CreateContactDto } from './dto/create-contact.dto.js';
import { UpdateContactDto } from './dto/update-contact.dto.js';
import { ContactResponseDto } from './dto/contact-response.dto.js';
import { MessageDto } from '../../common/dto/message.dto.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';

/**
 * Contacts hanging off a job. The parent is taken from the route prefix and
 * never from the body — that is what lets `ContactsService` treat the
 * `{ jobId }` ref as the sole source of truth for both the ownership check and
 * the FK it writes. `CompanyContactsController` below is the same surface for
 * the company-owned half, kept as a separate class so each mounts under its
 * own prefix and Swagger tag.
 */
@ApiTags('jobs')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@Controller('jobs')
export class ContactsController {
  constructor(private contactsService: ContactsService) {}

  /** Creates a contact under the job named in the route. */
  @Post(':jobId/contacts')
  @ApiOperation({ summary: 'Add a contact to a job' })
  @ApiParam({ name: 'jobId', description: 'Job ID' })
  @ApiCreatedResponse({ type: ContactResponseDto })
  @ApiNotFoundResponse({ description: 'Job not found' })
  create(
    @CurrentUser() user: { id: string },
    @Param('jobId') jobId: string,
    @Body() dto: CreateContactDto,
  ) {
    return this.contactsService.create(user.id, { jobId }, dto);
  }

  /** Lists the job's contacts. */
  @Get(':jobId/contacts')
  @ApiOperation({ summary: 'List contacts for a job' })
  @ApiParam({ name: 'jobId', description: 'Job ID' })
  @ApiOkResponse({ type: ContactResponseDto, isArray: true })
  @ApiNotFoundResponse({ description: 'Job not found' })
  findAll(@CurrentUser() user: { id: string }, @Param('jobId') jobId: string) {
    return this.contactsService.findAllFor(user.id, { jobId });
  }

  /** Updates one of the job's contacts. */
  @Patch(':jobId/contacts/:contactId')
  @ApiOperation({ summary: 'Update a contact' })
  @ApiParam({ name: 'jobId', description: 'Job ID' })
  @ApiParam({ name: 'contactId', description: 'Contact ID' })
  @ApiOkResponse({ type: ContactResponseDto })
  @ApiNotFoundResponse({ description: 'Job or contact not found' })
  update(
    @CurrentUser() user: { id: string },
    @Param('jobId') jobId: string,
    @Param('contactId') contactId: string,
    @Body() dto: UpdateContactDto,
  ) {
    return this.contactsService.update(user.id, { jobId }, contactId, dto);
  }

  /** Deletes one of the job's contacts. */
  @Delete(':jobId/contacts/:contactId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a contact' })
  @ApiParam({ name: 'jobId', description: 'Job ID' })
  @ApiParam({ name: 'contactId', description: 'Contact ID' })
  @ApiOkResponse({ type: MessageDto })
  @ApiNotFoundResponse({ description: 'Job or contact not found' })
  remove(
    @CurrentUser() user: { id: string },
    @Param('jobId') jobId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.contactsService.remove(user.id, { jobId }, contactId);
  }
}

/**
 * The company-owned half of the same surface, delegating to the same service
 * with a `{ companyId }` ref. A contact belongs to exactly one parent, so a
 * row created here is invisible to the job-scoped routes above.
 */
@ApiTags('companies')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@Controller('companies')
export class CompanyContactsController {
  constructor(private contactsService: ContactsService) {}

  /** Creates a contact under the company named in the route. */
  @Post(':companyId/contacts')
  @ApiOperation({ summary: 'Add an HR/company contact to a target company' })
  @ApiParam({ name: 'companyId', description: 'Company ID' })
  @ApiCreatedResponse({ type: ContactResponseDto })
  @ApiNotFoundResponse({ description: 'Company not found' })
  create(
    @CurrentUser() user: { id: string },
    @Param('companyId') companyId: string,
    @Body() dto: CreateContactDto,
  ) {
    return this.contactsService.create(user.id, { companyId }, dto);
  }

  /** Lists the company's contacts. */
  @Get(':companyId/contacts')
  @ApiOperation({ summary: 'List contacts for a target company' })
  @ApiParam({ name: 'companyId', description: 'Company ID' })
  @ApiOkResponse({ type: ContactResponseDto, isArray: true })
  @ApiNotFoundResponse({ description: 'Company not found' })
  findAll(
    @CurrentUser() user: { id: string },
    @Param('companyId') companyId: string,
  ) {
    return this.contactsService.findAllFor(user.id, { companyId });
  }

  /** Updates one of the company's contacts. */
  @Patch(':companyId/contacts/:contactId')
  @ApiOperation({ summary: 'Update a company contact' })
  @ApiParam({ name: 'companyId', description: 'Company ID' })
  @ApiParam({ name: 'contactId', description: 'Contact ID' })
  @ApiOkResponse({ type: ContactResponseDto })
  @ApiNotFoundResponse({ description: 'Company or contact not found' })
  update(
    @CurrentUser() user: { id: string },
    @Param('companyId') companyId: string,
    @Param('contactId') contactId: string,
    @Body() dto: UpdateContactDto,
  ) {
    return this.contactsService.update(user.id, { companyId }, contactId, dto);
  }

  /** Deletes one of the company's contacts. */
  @Delete(':companyId/contacts/:contactId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a company contact' })
  @ApiParam({ name: 'companyId', description: 'Company ID' })
  @ApiParam({ name: 'contactId', description: 'Contact ID' })
  @ApiOkResponse({ type: MessageDto })
  @ApiNotFoundResponse({ description: 'Company or contact not found' })
  remove(
    @CurrentUser() user: { id: string },
    @Param('companyId') companyId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.contactsService.remove(user.id, { companyId }, contactId);
  }
}
