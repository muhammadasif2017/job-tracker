import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { QUEUE_COMMAND_TIMEOUT_MS } from './redis-connection.helper.js';

/**
 * Longest boot waits for the first connection before starting anyway. Long
 * enough for a healthy Redis on the same host or network to answer, short
 * enough that a Redis that is down does not hold up the API.
 */
export const REDIS_READY_TIMEOUT_MS = 5000;

/**
 * The app's shared Redis client for request-path state: idempotency keys
 * and `AuthService`'s one-time OAuth codes. BullMQ keeps its own connections.
 *
 * Fails fast like the BullMQ queue connection (ADR-046). Each caller decides
 * what a failed command means — the idempotency layer runs the request
 * anyway, the OAuth code store answers 503 — so a command during an outage
 * should reject rather than wait behind reconnect attempts and stall the
 * request. Unlike BullMQ, commands never wait for the first connection, so
 * this also holds when Redis is down at boot. Boot itself waits for it,
 * briefly: see `onModuleInit`.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
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
   * Waits up to `REDIS_READY_TIMEOUT_MS` for the first connection before the
   * app starts taking requests. With the offline queue off, a command sent
   * while the client is still connecting fails at once, so without this
   * the first requests after a deploy could get a spurious 503 or skip
   * idempotency. If Redis is not up in time, boot continues and callers fall
   * back as they do for any outage.
   */
  async onModuleInit() {
    if (this.client.status === 'ready') return;
    let timer: NodeJS.Timeout | undefined;
    let onReady: (() => void) | undefined;
    const ready = await Promise.race([
      new Promise<boolean>((resolve) => {
        onReady = () => resolve(true);
        this.client.once('ready', onReady);
      }),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), REDIS_READY_TIMEOUT_MS);
      }),
    ]);
    clearTimeout(timer);
    if (onReady) this.client.off('ready', onReady);
    if (!ready) {
      this.logger.warn(
        `Redis not ready after ${REDIS_READY_TIMEOUT_MS}ms; starting without it`,
      );
    }
  }

  /**
   * Closes the connection so a shutdown or a test teardown does not hang on
   * an open socket.
   */
  async onModuleDestroy() {
    await this.client.quit();
  }
}
