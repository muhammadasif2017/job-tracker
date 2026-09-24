import type { RedisOptions } from 'bullmq';

/**
 * Longest a queue command may wait for Redis to answer. Covers a Redis that
 * stops responding without closing the socket, which `enableOfflineQueue:
 * false` alone does not catch. A `queue.add` is one Lua script and answers
 * in well under a millisecond when Redis is healthy.
 */
export const QUEUE_COMMAND_TIMEOUT_MS = 2000;

/** Host, port and password from `REDIS_URL`, shared by both shapes below. */
function baseConnection(): RedisOptions {
  const u = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
  };
}

/**
 * The connection for BullMQ `Queue` instances — the producer side, which the
 * request path awaits in `queue.add`. It fails fast: with the ioredis
 * defaults BullMQ needs for workers, an add during a Redis outage queued
 * behind reconnect attempts forever and hung the HTTP request that made it
 * (ADR-046). Every producer already treats a rejected add as best-effort,
 * so failing is the behaviour those callers were written for.
 *
 * Never give this to a worker: its blocking commands outlive
 * `commandTimeout`, and BullMQ requires `maxRetriesPerRequest: null` there.
 */
export function queueConnection(): RedisOptions {
  return {
    ...baseConnection(),
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    commandTimeout: QUEUE_COMMAND_TIMEOUT_MS,
  };
}

/**
 * The connection for BullMQ workers: waits out an outage and resumes, which
 * is what a background consumer should do. `maxRetriesPerRequest: null` is
 * required by BullMQ for blocking connections.
 */
export function workerConnection(): RedisOptions {
  return { ...baseConnection(), maxRetriesPerRequest: null };
}

/**
 * `@Processor` options with the worker connection, resolved when the worker
 * is built rather than when the decorator runs. Decorator arguments are
 * evaluated at import, before `ConfigModule` loads `.env`, so an eager
 * `workerConnection()` there would read an unset `REDIS_URL` locally and
 * silently fall back to localhost. `@nestjs/bullmq` spreads these options
 * into the `Worker` constructor at module init, which reads the getter.
 */
export function withWorkerConnection<T extends object>(
  options: T,
): T & { readonly connection: RedisOptions } {
  return {
    ...options,
    get connection() {
      return workerConnection();
    },
  };
}
