import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { ENRICHMENT_QUEUE } from './enrichment.processor.js';

@Injectable()
export class EnrichmentService {
  constructor(@InjectQueue(ENRICHMENT_QUEUE) private readonly queue: Queue) {}

  async enqueueEnrichment(jobId: string): Promise<void> {
    await this.queue.add(
      'enrich',
      { jobId },
      { attempts: 2, backoff: { type: 'fixed', delay: 10_000 } },
    );
  }
}
