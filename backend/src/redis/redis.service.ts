import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { QUEUE_COMMAND_TIMEOUT_MS } from './redis-connection.helper.js';

/**
 * The app's shared Redis client for request-path state — idempotency keys
 * and response caches. BullMQ keeps its own connections, and `AuthService`
 * still opens its own for OAuth codes.
 *
 * Fails fast like the BullMQ queue connection (ADR-046): callers treat
 * Redis as best-effort, so a command during an outage should reject rather
 * than wait behind reconnect attempts and stall the request. Unlike BullMQ,
 * nothing here waits for the first connection, so this also holds when
 * Redis is down at boot.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;
  private readonly logger = new Logger(RedisService.name);

  constructor(config: ConfigService) {
    this.client = new Redis(
      config.get<string>('REDIS_URL') ?? 'redis://localhost:6379',
      {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        commandTimeout: QUEUE_COMMAND_TIMEOUT_MS,
      },
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
