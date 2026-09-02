import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { ApiTags, ApiOperation, ApiOkResponse } from '@nestjs/swagger';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { RedisHealthIndicator } from './redis.health.js';

// Terminus defaults this ping to 1000ms, which is shorter than the database
// takes to answer at all after an idle spell: Postgres is hosted on Neon,
// whose free tier suspends the compute when idle and has to resume it on the
// next connection. The result was a 503 reporting "timeout of 1000ms
// exceeded" on the first probe after a quiet period, on a database that was
// fine — the immediately following probe answered in 750ms and steady-state
// probes in ~200ms. 5s clears the resume with room to spare while still
// failing fast enough to be a useful signal when the database is genuinely
// unreachable. Nothing polls this on an interval in production (the backend
// service in docker-compose.prod.yml declares no healthcheck, and Caddy
// doesn't probe), so a slower answer there costs only the caller's wait. The
// one automated consumer is CI's boot gate (`wait-on --timeout 60000
// .../health` in e2e-pr.yml and e2e-nightly.yml), which is unaffected:
// Postgres is a local container in those runs with nothing to resume, so the
// ping resolves in milliseconds and never approaches this ceiling.
const DB_PING_TIMEOUT_MS = 5000;

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private db: PrismaHealthIndicator,
    private prisma: PrismaService,
    private redis: RedisHealthIndicator,
  ) {}

  @Public()
  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Check database and Redis connectivity' })
  @ApiOkResponse({ description: 'All services healthy' })
  check() {
    return this.health.check([
      () =>
        this.db.pingCheck('database', this.prisma, {
          timeout: DB_PING_TIMEOUT_MS,
        }),
      () => this.redis.isHealthy('redis'),
    ]);
  }
}
