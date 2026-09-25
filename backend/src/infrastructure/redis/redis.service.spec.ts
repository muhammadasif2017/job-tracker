import { EventEmitter } from 'node:events';
import { ConfigService } from '@nestjs/config';
import { REDIS_READY_TIMEOUT_MS, RedisService } from './redis.service.js';

/** The fake ioredis client the mocked constructor hands out, per test. */
class FakeRedis extends EventEmitter {
  status = 'connecting';
  quit = jest.fn().mockResolvedValue('OK');
}
let fake: FakeRedis;

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn(() => fake),
}));

const config = {
  get: jest.fn().mockReturnValue('redis://localhost:6379'),
} as unknown as ConfigService;

describe('RedisService', () => {
  beforeEach(() => {
    fake = new FakeRedis();
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  it('returns at once when the client is already connected', async () => {
    fake.status = 'ready';
    const service = new RedisService(config);

    await expect(service.onModuleInit()).resolves.toBeUndefined();
    // Only the service's own outage-tracking listener; boot left none behind.
    expect(fake.listenerCount('ready')).toBe(1);
  });

  it('waits for the first connection before boot continues', async () => {
    const service = new RedisService(config);
    let done = false;
    const init = service.onModuleInit().then(() => (done = true));

    await jest.advanceTimersByTimeAsync(100);
    expect(done).toBe(false);

    fake.status = 'ready';
    fake.emit('ready');
    await init;
    expect(done).toBe(true);
    // Only the service's own outage-tracking listener; boot left none behind.
    expect(fake.listenerCount('ready')).toBe(1);
  });

  it('gives up after the timeout so a down Redis does not block boot', async () => {
    const service = new RedisService(config);
    const warn = jest
      .spyOn(
        (service as unknown as { logger: { warn: jest.Mock } }).logger,
        'warn',
      )
      .mockImplementation(() => undefined);
    const init = service.onModuleInit();

    await jest.advanceTimersByTimeAsync(REDIS_READY_TIMEOUT_MS);
    await init;

    expect(warn).toHaveBeenCalledWith(
      { timeoutMs: REDIS_READY_TIMEOUT_MS },
      expect.stringContaining('Redis not ready'),
    );
    // Only the service's own outage-tracking listener; boot left none behind.
    expect(fake.listenerCount('ready')).toBe(1);
  });

  it('logs connection errors instead of letting them crash the process', () => {
    const service = new RedisService(config);
    const error = jest
      .spyOn(
        (service as unknown as { logger: { error: jest.Mock } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);

    fake.emit('error', new Error('ECONNREFUSED'));

    expect(error).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      'Redis connection error',
    );
  });

  it('logs an outage at error level once, then each retry at debug, until Redis is back', () => {
    const service = new RedisService(config);
    const logger = (
      service as unknown as {
        logger: { error: jest.Mock; debug: jest.Mock; log: jest.Mock };
      }
    ).logger;
    const error = jest
      .spyOn(logger, 'error')
      .mockImplementation(() => undefined);
    const debug = jest
      .spyOn(logger, 'debug')
      .mockImplementation(() => undefined);
    const log = jest.spyOn(logger, 'log').mockImplementation(() => undefined);

    fake.emit('error', new Error('ECONNREFUSED'));
    fake.emit('error', new Error('ECONNREFUSED'));
    fake.emit('error', new Error('ECONNREFUSED'));

    expect(error).toHaveBeenCalledTimes(1);
    expect(debug).toHaveBeenCalledTimes(2);

    fake.emit('ready');
    fake.emit('error', new Error('ECONNREFUSED'));

    expect(log).toHaveBeenCalledWith('Redis connection restored');
    // A new outage is logged at error level again.
    expect(error).toHaveBeenCalledTimes(2);
  });

  it('closes the connection on shutdown', async () => {
    const service = new RedisService(config);

    await service.onModuleDestroy();

    expect(fake.quit).toHaveBeenCalled();
  });
});
