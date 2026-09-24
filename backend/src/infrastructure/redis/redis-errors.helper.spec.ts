import { isCommandTimeout, isRedisUnavailable } from './redis-errors.helper.js';

describe('redis-errors.helper', () => {
  const ready = { status: 'ready' };

  it('recognizes an ioredis commandTimeout rejection', () => {
    expect(isCommandTimeout(new Error('Command timed out'))).toBe(true);
    expect(isCommandTimeout(new Error('ECONNREFUSED'))).toBe(false);
    expect(isCommandTimeout('Command timed out')).toBe(false);
  });

  it('treats any failure on a client that is not connected as unavailable', () => {
    const err = new Error(
      "Stream isn't writeable and enableOfflineQueue options is false",
    );

    expect(isRedisUnavailable({ status: 'reconnecting' }, err)).toBe(true);
    expect(isRedisUnavailable({ status: 'connecting' }, err)).toBe(true);
  });

  it('treats a timeout on a connected client as unavailable', () => {
    expect(isRedisUnavailable(ready, new Error('Command timed out'))).toBe(
      true,
    );
  });

  it('does not treat a permanent error on a connected client as unavailable', () => {
    expect(
      isRedisUnavailable(ready, new Error("ERR unknown command 'getdel'")),
    ).toBe(false);
    expect(
      isRedisUnavailable(ready, new Error('WRONGPASS invalid password')),
    ).toBe(false);
  });
});
