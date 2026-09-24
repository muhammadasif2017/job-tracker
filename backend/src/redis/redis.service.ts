import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * The app's shared Redis client for request-path state — idempotency keys
 * and response caches. BullMQ keeps its own connections, and `AuthService`
 * still opens its own for OAuth codes.
 *
 * `maxRetriesPerRequest: 1` keeps a Redis outage from stalling a request:
 * callers treat Redis as best-effort and fall back to the database, so a
 * command should fail fast rather than queue behind reconnect attempts.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;
  private readonly logger = new Logger(RedisService.name);

  constructor(config: ConfigService) {
    this.client = new Redis(
      config.get<string>('REDIS_URL') ?? 'redis://localhost:6379',
      { maxRetriesPerRequest: 1 },
    );
    this.client.on('error', (err) =>
      this.logger.error('Redis connection error', err),
    );
  }

  /**
   * Closes the connection so a shutdown or a test teardown does not hang on
   * an open socket.
   */
  async onModuleDestroy() {
    await this.client.quit();
  }
}
