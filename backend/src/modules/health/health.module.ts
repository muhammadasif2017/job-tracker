import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller.js';
import { RedisHealthIndicator } from './redis.health.js';
import { COMPANY_ENRICHMENT_QUEUE } from '../companies/enrichment/company-enrichment.constants.js';

@Module({
  imports: [
    TerminusModule,
    BullModule.registerQueue({ name: COMPANY_ENRICHMENT_QUEUE }),
  ],
  controllers: [HealthController],
  providers: [RedisHealthIndicator],
})
export class HealthModule {}
