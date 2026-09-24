import {
  QUEUE_COMMAND_TIMEOUT_MS,
  queueConnection,
  withWorkerConnection,
  workerConnection,
} from './redis-connection.helper.js';

describe('redis-connection.helper', () => {
  const original = process.env.REDIS_URL;

  afterEach(() => {
    if (original === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = original;
  });

  it('parses host, port and a URL-encoded password from REDIS_URL', () => {
    process.env.REDIS_URL = 'redis://:p%40ss@cache.internal:6380';

    expect(workerConnection()).toMatchObject({
      host: 'cache.internal',
      port: 6380,
      password: 'p@ss',
    });
  });

  it('falls back to localhost:6379 with no password when REDIS_URL is unset', () => {
    delete process.env.REDIS_URL;

    const conn = workerConnection();
    expect(conn).toMatchObject({ host: 'localhost', port: 6379 });
    expect(conn).not.toHaveProperty('password');
  });

  it('makes the queue connection fail fast instead of waiting out an outage', () => {
    expect(queueConnection()).toMatchObject({
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      commandTimeout: QUEUE_COMMAND_TIMEOUT_MS,
    });
  });

  it('keeps the worker connection on the settings BullMQ requires for blocking commands', () => {
    const conn = workerConnection();

    expect(conn.maxRetriesPerRequest).toBeNull();
    expect(conn).not.toHaveProperty('enableOfflineQueue');
    expect(conn).not.toHaveProperty('commandTimeout');
  });

  it('resolves the worker connection when read, not when the options are built', () => {
    process.env.REDIS_URL = 'redis://early:6379';
    const options = withWorkerConnection({ lockDuration: 90_000 });
    process.env.REDIS_URL = 'redis://late:6379';

    // Spread the way @nestjs/bullmq does when it builds the Worker.
    const built = { ...options };

    expect(built.lockDuration).toBe(90_000);
    expect(built.connection).toMatchObject({
      host: 'late',
      maxRetriesPerRequest: null,
    });
  });
});
