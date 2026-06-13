import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { HealthIndicatorService } from '@nestjs/terminus';
import { ENRICHMENT_QUEUE } from '../enrichment/enrichment.processor.js';

@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    @InjectQueue(ENRICHMENT_QUEUE) private readonly queue: Queue,
  ) {}

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
