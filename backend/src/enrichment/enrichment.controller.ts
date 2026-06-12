import { Controller, NotFoundException, Param, Post } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { EnrichmentService } from './enrichment.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

@Controller('jobs')
export class EnrichmentController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly enrichment: EnrichmentService,
  ) {}

  @Post(':id/enrich')
  async triggerEnrichment(
    @CurrentUser() user: { id: string },
    @Param('id') jobId: string,
  ) {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, userId: user.id },
    });
    if (!job) throw new NotFoundException('Job not found');

    await this.enrichment.enqueueEnrichment(jobId);
    return { message: 'Enrichment queued' };
  }
}
