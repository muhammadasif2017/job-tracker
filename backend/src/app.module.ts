import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bullmq';
import { LoggerModule } from 'nestjs-pino';
import * as Joi from 'joi';
import { PrismaModule } from './prisma/prisma.module.js';
import { queueConnection } from './redis/redis-connection.helper.js';
import { RedisModule } from './redis/redis.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { JobsModule } from './modules/jobs/jobs.module.js';
import { JobsStatsModule } from './modules/jobs-stats/jobs-stats.module.js';
import { JobParsingModule } from './modules/job-parsing/job-parsing.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { EnrichmentModule } from './modules/enrichment/enrichment.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { StorageModule } from './storage/storage.module.js';
import { ResumesModule } from './modules/resumes/resumes.module.js';
import { InterviewRoundsModule } from './modules/interview-rounds/interview-rounds.module.js';
import { ContactsModule } from './modules/contacts/contacts.module.js';
import { CompaniesModule } from './modules/companies/companies.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { TokensModule } from './modules/tokens/tokens.module.js';

/** Required only when `STORAGE_DRIVER=oracle`; optional for local storage. */
const ociRequired = Joi.when('STORAGE_DRIVER', {
  is: 'oracle',
  then: Joi.string().required(),
  otherwise: Joi.string().optional(),
});

/**
 * Root module. Validates the environment at boot, so a missing required
 * variable stops startup, and wires global rate limiting, cron scheduling, the
 * BullMQ Redis connection and pino logging with credentials redacted. The JWT,
 * roles and PAT-scope guards are registered globally in `main.ts`, not here.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({
        NODE_ENV: Joi.string()
          .valid('development', 'production', 'test')
          .default('development'),
        DATABASE_URL: Joi.string().required(),
        PORT: Joi.number().default(3001),
        JWT_SECRET: Joi.string().min(32).required(),
        JWT_REFRESH_SECRET: Joi.string().min(32).required(),
        JWT_EXPIRES_IN: Joi.string().default('15m'),
        JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),
        FRONTEND_URL: Joi.string().default('http://localhost:3000'),
        REDIS_URL: Joi.string().default('redis://localhost:6379'),
        GROQ_API_KEY: Joi.string().optional(),
        TAVILY_API_KEY: Joi.string().optional(),
        GOOGLE_CLIENT_ID: Joi.string().optional(),
        GOOGLE_CLIENT_SECRET: Joi.string().optional(),
        GITHUB_CLIENT_ID: Joi.string().optional(),
        GITHUB_CLIENT_SECRET: Joi.string().optional(),
        RESEND_API_KEY: Joi.string().optional(),
        EMAIL_FROM: Joi.string().default('onboarding@resend.dev'),
        STORAGE_DRIVER: Joi.string().valid('local', 'oracle').default('local'),
        OCI_NAMESPACE: ociRequired,
        OCI_REGION: ociRequired,
        OCI_BUCKET_NAME: ociRequired,
        OCI_ACCESS_KEY_ID: ociRequired,
        OCI_SECRET_ACCESS_KEY: ociRequired,
      }),
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
