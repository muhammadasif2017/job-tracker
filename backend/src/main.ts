import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { withoutUnversionedAliases } from './config/api-versioning.helper.js';
import { configureApp } from './config/configure-app.helper.js';

/**
 * Boots the API: the logger, the shared request pipeline (`configureApp`),
 * and non-production Swagger docs at `/api/docs`.
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
}
void bootstrap();
