import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { HealthIndicatorService } from '@nestjs/terminus';
import { COMPANY_ENRICHMENT_QUEUE } from '../companies/enrichment/company-enrichment.constants.js';

/**
 * Terminus indicator for Redis. It goes through a BullMQ queue's connection
 * rather than a separate client, so it checks the connection the workers
 * actually use.
 */
@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    @InjectQueue(COMPANY_ENRICHMENT_QUEUE) private readonly queue: Queue,
  ) {}

  /** Reports up if a cheap queue read reaches Redis, down with the error otherwise. */
  async isHealthy(key: string) {
    const indicator = this.healthIndicatorService.check(key);
    try {
      await this.queue.getJobCounts('waiting');
      return indicator.up();
    } catch (err) {
      return indicator.down({
        message: err instanceof Error ? err.message : 'Redis unreachable',
      });
    }
  }
}
