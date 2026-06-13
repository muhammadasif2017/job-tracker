import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller.js';
import { RedisHealthIndicator } from './redis.health.js';
import { ENRICHMENT_QUEUE } from '../enrichment/enrichment.processor.js';

@Module({
  imports: [
    TerminusModule,
    BullModule.registerQueue({ name: ENRICHMENT_QUEUE }),
  ],
  controllers: [HealthController],
  providers: [RedisHealthIndicator],
})
export class HealthModule {}
