import {
  Controller,
  ConflictException,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { EnrichmentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { EnrichmentService } from './enrichment.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

@Controller('jobs')
export class EnrichmentController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly enrichment: EnrichmentService,
  ) {}

  @HttpCode(HttpStatus.ACCEPTED)
  @Post(':id/enrichment')
  async triggerEnrichment(
    @CurrentUser() user: { id: string },
    @Param('id') jobId: string,
  ) {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, userId: user.id },
    });
    if (!job) throw new NotFoundException('Job not found');

    const existing = await this.prisma.companyProfile.findFirst({
      where: { jobId },
    });
    if (
      existing?.status === EnrichmentStatus.PENDING ||
      existing?.status === EnrichmentStatus.PROCESSING
    ) {
      throw new ConflictException('Enrichment already in progress');
    }

    await this.enrichment.enqueueEnrichment(jobId);
    return { message: 'Enrichment queued' };
  }
}
