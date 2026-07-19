import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bullmq';
import { LoggerModule } from 'nestjs-pino';
import * as Joi from 'joi';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { JobsModule } from './modules/jobs/jobs.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { EnrichmentModule } from './modules/enrichment/enrichment.module.js';
import { StorageModule } from './storage/storage.module.js';
import { ResumesModule } from './modules/resumes/resumes.module.js';
import { InterviewRoundsModule } from './modules/interview-rounds/interview-rounds.module.js';

const ociRequired = Joi.when('STORAGE_DRIVER', {
  is: 'oracle',
  then: Joi.string().required(),
  otherwise: Joi.string().optional(),
});

function parseRedisConnection() {
  const u = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    maxRetriesPerRequest: null,
  };
}

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
      connection: parseRedisConnection(),
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
        ],
      },
    }),
    PrismaModule,
    StorageModule,
    AuthModule,
    ResumesModule,
    InterviewRoundsModule,
    UsersModule,
    JobsModule,
    HealthModule,
    EnrichmentModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
