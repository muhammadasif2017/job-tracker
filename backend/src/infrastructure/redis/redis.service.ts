import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { QUEUE_COMMAND_TIMEOUT_MS } from './redis-connection.helper.js';
import { isRedisOutage, setRedisOutage } from './redis-errors.helper.js';
import { appLogger } from '../error-tracking/app-logger.helper.js';

/**
 * Longest boot waits for the first connection before starting anyway. Long
 * enough for a healthy Redis on the same host or network to answer, short
 * enough that a Redis that is down does not hold up the API.
 */
export const REDIS_READY_TIMEOUT_MS = 5000;

/**
 * Socket error codes that mean the connection itself dropped. ioredis emits
 * them before it changes its status, so they arrive while it still reads
 * 'ready' and have to be recognised by code.
 */
const CONNECTION_DROP_CODES = new Set([
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'ECONNREFUSED',
]);

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
  private readonly logger = appLogger(RedisService);
  /**
   * When the current outage was logged, for its duration in the "restored"
   * line. Whether an outage is on is the shared flag in redis-errors.helper,
   * the one `logRedisFailure` reads, so there is a single source of truth.
   */
  private outageStartedAt = 0;

  constructor(config: ConfigService) {
    this.client = new Redis(
      config.get<string>('REDIS_URL') ?? 'redis://localhost:6379',
      {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        commandTimeout: QUEUE_COMMAND_TIMEOUT_MS,
      },
    );
    // One error line per outage, not per reconnect attempt: ioredis retries
    // about every 2 s, and each error line also goes to Sentry Logs
    // (ADR-053). The retries still show at debug level on the VM. An error
    // on a connection that is still up (ioredis emits a few, such as a
    // command queue fault) is always logged and does not start an outage:
    // no 'ready' would follow to end it, and the next real outage would then
    // be logged at debug only. A socket error that means the connection
    // dropped does start one, even though ioredis still reads 'ready' then.
    // The outage state is shared with `logRedisFailure`, so the lines an
    // outage causes elsewhere drop to debug for its duration.
    this.client.on('error', (err: Error & { code?: string }) => {
      const dropped =
        err.code !== undefined && CONNECTION_DROP_CODES.has(err.code);
      if (this.client.status === 'ready' && !dropped) {
        this.logger.error({ err }, 'Redis error on a live connection');
        return;
      }
      if (isRedisOutage()) {
        this.logger.debug({ err }, 'Redis connection error (still down)');
        return;
      }
      this.outageStartedAt = Date.now();
      setRedisOutage(true);
      this.logger.error({ err }, 'Redis connection error');
    });
    this.client.on('ready', () => {
      if (!isRedisOutage()) return;
      setRedisOutage(false);
      // Warn, not info, so it reaches Sentry Logs next to the error line and
      // an outage visibly ends there, with how long it lasted.
      this.logger.warn(
        { outageMs: Date.now() - this.outageStartedAt },
        'Redis connection restored',
      );
    });
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
        { timeoutMs: REDIS_READY_TIMEOUT_MS },
        'Redis not ready in time; starting without it',
      );
    }
  }

  /**
   * Closes the connection so a shutdown or a test teardown does not hang on
   * an open socket.
   */
  async onModuleDestroy() {
    // The outage flag is process-wide: an app closed mid-outage must not
    // leave it set for the next one in the same process (the e2e suite).
    setRedisOutage(false);
    await this.client.quit();
  }
}
