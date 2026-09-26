import { EventEmitter } from 'node:events';
import { ConfigService } from '@nestjs/config';
import { REDIS_READY_TIMEOUT_MS, RedisService } from './redis.service.js';
import { isRedisOutage, setRedisOutage } from './redis-errors.helper.js';
import { spyOnLogger } from '../../../test/spy-on-logger.js';

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
  const logger = spyOnLogger();

  beforeEach(() => {
    jest.clearAllMocks();
    setRedisOutage(false);
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
    const warn = logger.warn;
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
    new RedisService(config);
    const error = logger.error;

    fake.emit('error', new Error('ECONNREFUSED'));

    expect(error).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      'Redis connection error',
    );
  });

  it('logs an outage at error level once, then each retry at debug, until Redis is back', () => {
    new RedisService(config);
    const { error, debug } = logger;

    fake.emit('error', new Error('ECONNREFUSED'));
    fake.emit('error', new Error('ECONNREFUSED'));
    fake.emit('error', new Error('ECONNREFUSED'));

    expect(error).toHaveBeenCalledTimes(1);
    expect(debug).toHaveBeenCalledTimes(2);

    fake.emit('ready');
    fake.emit('error', new Error('ECONNREFUSED'));

    expect(logger.warn).toHaveBeenCalledWith(
      { outageMs: expect.any(Number) },
      'Redis connection restored',
    );
    // A new outage is logged at error level again.
    expect(error).toHaveBeenCalledTimes(2);
  });

  it('does not start an outage for an error on a live connection', () => {
    new RedisService(config);
    const error = logger.error;

    fake.status = 'ready';
    fake.emit('error', new Error('Command queue state error'));
    fake.status = 'reconnecting';
    fake.emit('error', new Error('ECONNREFUSED'));

    // Both at error level: the first did not mark an outage, so the real
    // one that follows is not demoted to debug.
    expect(error).toHaveBeenNthCalledWith(
      1,
      { err: expect.any(Error) },
      'Redis error on a live connection',
    );
    expect(error).toHaveBeenNthCalledWith(
      2,
      { err: expect.any(Error) },
      'Redis connection error',
    );
  });

  it('treats a connection reset as the start of an outage, though ioredis still reads ready', () => {
    new RedisService(config);

    fake.status = 'ready';
    fake.emit(
      'error',
      Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
    );
    fake.status = 'reconnecting';
    fake.emit('error', new Error('ECONNREFUSED'));

    // One error line for the outage, then debug; not a "live connection" line.
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      'Redis connection error',
    );
    expect(logger.debug).toHaveBeenCalledTimes(1);
  });

  it('shares the outage state with logRedisFailure until Redis is back', () => {
    new RedisService(config);

    fake.emit('error', new Error('ECONNREFUSED'));
    expect(isRedisOutage()).toBe(true);

    fake.emit('ready');
    expect(isRedisOutage()).toBe(false);
  });

  it('treats a refused login as a misconfiguration, not an outage', () => {
    new RedisService(config);
    const refused = Object.assign(new Error('WRONGPASS invalid password'), {
      name: 'ReplyError',
    });

    fake.status = 'connect';
    fake.emit('error', refused);

    expect(logger.error).toHaveBeenCalledWith(
      { err: refused },
      'Redis rejected the connection',
    );
    expect(isRedisOutage()).toBe(false);
  });

  it('ignores an error emitted while closing, so shutdown leaves no outage behind', async () => {
    const service = new RedisService(config);
    fake.quit.mockImplementationOnce(() => {
      fake.emit('error', new Error('ECONNREFUSED'));
      return Promise.resolve('OK');
    });

    await service.onModuleDestroy();

    expect(isRedisOutage()).toBe(false);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('closes the connection on shutdown, clearing an outage it had reported', async () => {
    const service = new RedisService(config);
    fake.emit('error', new Error('ECONNREFUSED'));

    await service.onModuleDestroy();

    expect(fake.quit).toHaveBeenCalled();
    expect(isRedisOutage()).toBe(false);
  });
});
