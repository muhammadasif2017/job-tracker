import { Global, Module } from '@nestjs/common';
import { MetricsService } from './metrics.service.js';

/** Provides `MetricsService` app-wide; global so feature modules need not import it. */
@Global()
@Module({
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
