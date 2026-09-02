import { NestFactory, Reflector } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js';
import { RolesGuard } from './common/guards/roles.guard.js';
import { PatScopeGuard } from './common/guards/pat-scope.guard.js';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));

  const config = app.get(ConfigService);

  // Caddy fronts the API in production (docker-compose.prod.yml). Without
  // this, Express resolves req.ip to Caddy's container address for every
  // request, so ThrottlerGuard (whose default tracker is req.ip) buckets the
  // entire internet together — the per-IP @Throttle limits on /auth/login and
  // /auth/register would be a single global 10/min instead of 10/min each.
  // Exactly one hop: Caddy appends the real client to X-Forwarded-For, so
  // trusting one proxy makes req.ip that client, while a client-supplied
  // X-Forwarded-For entry sits further left in the list and stays untrusted.
  // Deliberately not enabled outside production, where the app is reached
  // directly and a forged X-Forwarded-For would otherwise become req.ip.
  if (config.get('NODE_ENV') === 'production') {
    app.set('trust proxy', 1);
  }

  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: config.get<string>('FRONTEND_URL'),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.useGlobalGuards(
    new JwtAuthGuard(app.get(Reflector)),
    new RolesGuard(app.get(Reflector)),
    new PatScopeGuard(app.get(Reflector)),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());

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

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = config.get<number>('PORT') ?? 3001;
  await app.listen(port);
}
void bootstrap();
