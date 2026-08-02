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

@ApiTags('jobs')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@Controller('jobs')
export class ContactsController {
  constructor(private contactsService: ContactsService) {}

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
    return this.contactsService.create(user.id, jobId, dto);
  }

  @Get(':jobId/contacts')
  @ApiOperation({ summary: 'List contacts for a job' })
  @ApiParam({ name: 'jobId', description: 'Job ID' })
  @ApiOkResponse({ type: ContactResponseDto, isArray: true })
  @ApiNotFoundResponse({ description: 'Job not found' })
  findAll(@CurrentUser() user: { id: string }, @Param('jobId') jobId: string) {
    return this.contactsService.findAllForJob(user.id, jobId);
  }

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
    return this.contactsService.update(user.id, jobId, contactId, dto);
  }

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
    return this.contactsService.remove(user.id, jobId, contactId);
  }
}
