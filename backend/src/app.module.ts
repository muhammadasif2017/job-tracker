import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bullmq';
import { LoggerModule } from 'nestjs-pino';
import { ENV_VALIDATION_SCHEMA } from './config/env.constants.js';
import {
  currentRequestId,
  requestIdField,
} from './common/request-context.helper.js';
import { PrismaModule } from './infrastructure/database/prisma.module.js';
import { queueConnection } from './infrastructure/redis/redis-connection.helper.js';
import { RedisModule } from './infrastructure/redis/redis.module.js';
import { MetricsModule } from './infrastructure/metrics/metrics.module.js';
import { StorageModule } from './infrastructure/storage/storage.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { JobsModule } from './modules/jobs/jobs.module.js';
import { JobsStatsModule } from './modules/jobs-stats/jobs-stats.module.js';
import { JobParsingModule } from './modules/job-parsing/job-parsing.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { EnrichmentModule } from './modules/enrichment/enrichment.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { ResumesModule } from './modules/resumes/resumes.module.js';
import { InterviewRoundsModule } from './modules/interview-rounds/interview-rounds.module.js';
import { ContactsModule } from './modules/contacts/contacts.module.js';
import { CompaniesModule } from './modules/companies/companies.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { TokensModule } from './modules/tokens/tokens.module.js';

/**
 * Root module. Validates the environment at boot, so a missing required
 * variable stops startup, and wires global rate limiting, cron scheduling, the
 * BullMQ Redis connection and pino logging with credentials redacted. The JWT,
 * roles and PAT-scope guards are registered globally in `configureApp`
 * (`config/configure-app.helper.ts`), not here.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: ENV_VALIDATION_SCHEMA,
    }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    ScheduleModule.forRoot(),
    BullModule.forRoot({
      // Producer shape; each @Processor overrides it with the worker shape.
      connection: queueConnection(),
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined,
        autoLogging: true,
        // No genReqId: requestIdMiddleware runs first and sets req.id, which
        // pino-http reuses as-is (ADR-049). The mixin stamps every log line,
        // in a request or in a job it enqueued, with the correlation ID,
        // including lines written far from the request.
        mixin: () => requestIdField(currentRequestId()),
        redact: [
          'req.headers.authorization',
          'req.body.password',
          'req.body.currentPassword',
          'req.body.newPassword',
          'req.body.refreshToken',
          'req.body.token',
        ],
      },
    }),
    PrismaModule,
    RedisModule,
    MetricsModule,
    StorageModule,
    AuthModule,
    ResumesModule,
    InterviewRoundsModule,
    ContactsModule,
    CompaniesModule,
    UsersModule,
    // JobsStatsModule must stay above JobsModule: its routes (stats,
    // stats/funnel, stats/trend, export, attention, ghost-suggestions) are
    // fixed segments under `jobs`, and JobsController declares `:id`. Routes
    // are matched in registration order, so a later registration sends all
    // six into findOne and they 404. test/app.e2e-spec.ts asserts real body
    // shapes on those paths and fails if this order is changed.
    JobsStatsModule,
    JobsModule,
    JobParsingModule,
    HealthModule,
    EnrichmentModule,
    NotificationsModule,
    AdminModule,
    TokensModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
