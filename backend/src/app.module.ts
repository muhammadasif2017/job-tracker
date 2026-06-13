import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';
import { LoggerModule } from 'nestjs-pino';
import * as Joi from 'joi';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { HealthModule } from './health/health.module.js';
import { EnrichmentModule } from './enrichment/enrichment.module.js';
import { StorageModule } from './storage/storage.module.js';
import { ResumesModule } from './resumes/resumes.module.js';

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
        DATABASE_URL: Joi.string().required(),
        PORT: Joi.number().default(3001),
        JWT_SECRET: Joi.string().min(32).required(),
        JWT_REFRESH_SECRET: Joi.string().min(32).required(),
        JWT_EXPIRES_IN: Joi.string().default('15m'),
        JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),
        FRONTEND_URL: Joi.string().default('http://localhost:3000'),
        REDIS_URL: Joi.string().default('redis://localhost:6379'),
        ANTHROPIC_API_KEY: Joi.string().optional(),
        BRAVE_SEARCH_API_KEY: Joi.string().optional(),
        GOOGLE_CLIENT_ID: Joi.string().optional(),
        GOOGLE_CLIENT_SECRET: Joi.string().optional(),
        GITHUB_CLIENT_ID: Joi.string().optional(),
        GITHUB_CLIENT_SECRET: Joi.string().optional(),
        STORAGE_DRIVER: Joi.string().valid('local', 'oracle').default('local'),
        OCI_NAMESPACE: Joi.when('STORAGE_DRIVER', {
          is: 'oracle',
          then: Joi.string().required(),
          otherwise: Joi.string().optional(),
        }),
        OCI_REGION: Joi.when('STORAGE_DRIVER', {
          is: 'oracle',
          then: Joi.string().required(),
          otherwise: Joi.string().optional(),
        }),
        OCI_BUCKET_NAME: Joi.when('STORAGE_DRIVER', {
          is: 'oracle',
          then: Joi.string().required(),
          otherwise: Joi.string().optional(),
        }),
        OCI_ACCESS_KEY_ID: Joi.when('STORAGE_DRIVER', {
          is: 'oracle',
          then: Joi.string().required(),
          otherwise: Joi.string().optional(),
        }),
        OCI_SECRET_ACCESS_KEY: Joi.when('STORAGE_DRIVER', {
          is: 'oracle',
          then: Joi.string().required(),
          otherwise: Joi.string().optional(),
        }),
      }),
    }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    BullModule.forRoot({
      connection: parseRedisConnection(),
    }),
    LoggerModule.forRoot({
      pinoHttp: {
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
    UsersModule,
    JobsModule,
    HealthModule,
    EnrichmentModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
