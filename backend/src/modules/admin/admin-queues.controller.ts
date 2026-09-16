import { Controller, Get } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiForbiddenResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AdminQueuesService } from './admin-queues.service.js';
import { QueueObservabilityDto } from './dto/admin-queues.dto.js';
import { Roles } from '../../common/decorators/roles.decorator.js';

/**
 * Admin-only observability for the background queues. Read-only — nothing
 * here retries, drains or pauses a queue.
 */
@ApiTags('admin')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@ApiForbiddenResponse({ description: 'Requires ADMIN role' })
@Roles(Role.ADMIN)
@Controller('admin/queues')
export class AdminQueuesController {
  constructor(private adminQueuesService: AdminQueuesService) {}

  @Get()
  @ApiOperation({
    summary: 'Queue depths, company enrichment status counts, and the mismatch',
    description:
      'Reports both halves of the enrichment pipeline — BullMQ job counts and the Company.status distribution in Postgres — because a row stranded in one is invisible in the other.',
  })
  /** Returns the queue and enrichment-status snapshot in one response. */
  @ApiOkResponse({ type: QueueObservabilityDto })
  getObservability() {
    return this.adminQueuesService.getObservability();
  }
}
