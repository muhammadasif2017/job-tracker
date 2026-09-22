import { Module } from '@nestjs/common';
import { JobsStatsService } from './jobs-stats.service.js';
import { JobsStatsController } from './jobs-stats.controller.js';

/**
 * Read-only aggregates over a user's jobs: the dashboard figures, the
 * funnel, the trend buckets, CSV export, the needs-attention list and the
 * ghost suggestions.
 *
 * Imports nothing. `PrismaService` comes from the global `PrismaModule`, and
 * the filters and helpers these queries are built from (`jobs.constants.js`,
 * `attention.helper.js`, `ghost-suggestions.helper.js`) are plain function
 * imports from `../jobs/`, not providers — they stay there because
 * `JobsService`, `JobGhostingService`, `CompaniesService`'s application-stats
 * helper and the notification scheduler all read them too.
 *
 * Must be registered before `JobsModule` in `AppModule`; see the comment
 * there and the class comment on `JobsStatsController`.
 */
@Module({
  providers: [JobsStatsService],
  controllers: [JobsStatsController],
})
export class JobsStatsModule {}
