// Must stay first: Sentry has to patch modules before they load (ADR-050).
import './instrument.js';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { withoutUnversionedAliases } from './config/api-versioning.helper.js';
import { configureApp } from './config/configure-app.helper.js';
import { MetricsService } from './infrastructure/metrics/metrics.service.js';
import { startMetricsServer } from './infrastructure/metrics/metrics-server.helper.js';

/**
 * Boots the API: the logger, the shared request pipeline (`configureApp`),
 * non-production Swagger docs at `/api/docs`, and, when `METRICS_PORT` is
 * set, the Prometheus listener on that port (ADR-052).
 */
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));

  const config = app.get(ConfigService);
  configureApp(app);

  if (config.get('NODE_ENV') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Job Tracker API')
      .setDescription('REST API for the Job Tracker portfolio project')
      .setVersion('1.0')
      .addBearerAuth()
      .addTag('auth', 'Authentication — credentials & OAuth')
      .addTag('users', 'User profile management')
      .addTag('jobs', 'Job application tracking')
      .addTag('admin', 'Admin-only user management')
      .build();

    const document = withoutUnversionedAliases(
      SwaggerModule.createDocument(app, swaggerConfig),
    );
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = config.get<number>('PORT') ?? 3001;
  await app.listen(port);

  // Empty or unset means off, so local runs and the test suites open no
  // extra port.
  const metricsPort = config.get<number | ''>('METRICS_PORT');
  if (metricsPort) {
    const logger = app.get(Logger);
    const metrics = app.get(MetricsService);
    metrics.collectProcessMetrics();
    startMetricsServer(metricsPort, metrics.registry, (err) =>
      logger.error({ err }, 'Metrics listener failed', 'Bootstrap'),
    );
  }
}
void bootstrap();
