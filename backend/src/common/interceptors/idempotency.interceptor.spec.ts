import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  UnprocessableEntityException,
} from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import {
  COMPLETED_TTL_MS,
  IDEMPOTENCY_IN_PROGRESS_CODE,
  IdempotencyInterceptor,
  PENDING_TTL_MS,
} from './idempotency.interceptor.js';
import { RedisService } from '../../infrastructure/redis/redis.service.js';
import { createHash } from 'node:crypto';

const mockClient = { set: jest.fn(), get: jest.fn(), del: jest.fn() };
const setHeader = jest.fn();

const BODY = { company: 'Stripe', position: 'Engineer' };
const FINGERPRINT = createHash('sha256')
  .update(JSON.stringify(BODY))
  .digest('hex');
const REDIS_KEY = 'idem:u-1:POST:/jobs:key-1';

function context(
  headers: Record<string, string | string[]>,
  user: { id: string } | null = { id: 'u-1' },
  body: unknown = BODY,
) {
  const req = { headers, user, body, method: 'POST', path: '/jobs' };
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({ setHeader }),
    }),
  } as unknown as ExecutionContext;
}

function handler(result = of({ id: 'job-1' })) {
  return { handle: jest.fn(() => result) } as unknown as CallHandler & {
    handle: jest.Mock;
  };
}

describe('IdempotencyInterceptor', () => {
  let interceptor: IdempotencyInterceptor;

  beforeEach(() => {
    jest.clearAllMocks();
    interceptor = new IdempotencyInterceptor({
      client: mockClient,
    } as unknown as RedisService);
  });

  it('passes a request with no Idempotency-Key straight through', async () => {
    const next = handler();
    const result = await lastValueFrom(
      interceptor.intercept(context({}), next),
    );

    expect(result).toEqual({ id: 'job-1' });
    expect(mockClient.set).not.toHaveBeenCalled();
  });

  it('passes an unauthenticated request straight through', async () => {
    const next = handler();
    await lastValueFrom(
      interceptor.intercept(
        context({ 'idempotency-key': 'key-1' }, null),
        next,
      ),
    );

    expect(next.handle).toHaveBeenCalled();
    expect(mockClient.set).not.toHaveBeenCalled();
  });

  it.each([
    ['empty', '   '],
    ['oversized', 'x'.repeat(256)],
  ])('rejects an %s key with 400', (_label, key) => {
    expect(() =>
      interceptor.intercept(context({ 'idempotency-key': key }), handler()),
    ).toThrow(BadRequestException);
  });

  it('claims the key, runs the handler and stores the response for 24h', async () => {
    mockClient.set.mockResolvedValue('OK');
    const next = handler();

    const result = await lastValueFrom(
      interceptor.intercept(context({ 'idempotency-key': ' key-1 ' }), next),
    );

    expect(result).toEqual({ id: 'job-1' });
    expect(mockClient.set).toHaveBeenNthCalledWith(
      1,
      REDIS_KEY,
      JSON.stringify({ state: 'pending', fingerprint: FINGERPRINT }),
      'PX',
      PENDING_TTL_MS,
      'NX',
    );
    expect(mockClient.set).toHaveBeenNthCalledWith(
      2,
      REDIS_KEY,
      JSON.stringify({
        state: 'completed',
        fingerprint: FINGERPRINT,
        body: { id: 'job-1' },
      }),
      'PX',
      COMPLETED_TTL_MS,
    );
  });

  it('uses the first value when the header is repeated', async () => {
    mockClient.set.mockResolvedValue('OK');
    await lastValueFrom(
      interceptor.intercept(
        context({ 'idempotency-key': ['key-1', 'key-2'] }),
        handler(),
      ),
    );

    expect(mockClient.set.mock.calls[0][0]).toBe(REDIS_KEY);
  });

  it('replays a completed response without running the handler', async () => {
    mockClient.set.mockResolvedValue(null);
    mockClient.get.mockResolvedValue(
      JSON.stringify({
        state: 'completed',
        fingerprint: FINGERPRINT,
        body: { id: 'job-1' },
      }),
    );
    const next = handler();

    const result = await lastValueFrom(
      interceptor.intercept(context({ 'idempotency-key': 'key-1' }), next),
    );

    expect(result).toEqual({ id: 'job-1' });
    expect(next.handle).not.toHaveBeenCalled();
    expect(setHeader).toHaveBeenCalledWith('Idempotent-Replayed', 'true');
  });

  it('returns 409 while the first request with the key is still running', async () => {
    mockClient.set.mockResolvedValue(null);
    mockClient.get.mockResolvedValue(
      JSON.stringify({ state: 'pending', fingerprint: FINGERPRINT }),
    );
    const next = handler();

    const error = await lastValueFrom(
      interceptor.intercept(context({ 'idempotency-key': 'key-1' }), next),
    ).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ConflictException);
    // Clients tell this 409 apart from the route's other 409s by `code`.
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: IDEMPOTENCY_IN_PROGRESS_CODE,
    });
    expect(next.handle).not.toHaveBeenCalled();
  });

  it('returns 409 when the key expires between the claim and the read', async () => {
    mockClient.set.mockResolvedValue(null);
    mockClient.get.mockResolvedValue(null);

    await expect(
      lastValueFrom(
        interceptor.intercept(
          context({ 'idempotency-key': 'key-1' }),
          handler(),
        ),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns 422 when the key is reused with a different body', async () => {
    mockClient.set.mockResolvedValue(null);
    mockClient.get.mockResolvedValue(
      JSON.stringify({ state: 'completed', fingerprint: 'other', body: {} }),
    );
    const next = handler();

    await expect(
      lastValueFrom(
        interceptor.intercept(context({ 'idempotency-key': 'key-1' }), next),
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(next.handle).not.toHaveBeenCalled();
  });

  it('releases the key and rethrows when the handler fails', async () => {
    mockClient.set.mockResolvedValue('OK');
    mockClient.del.mockResolvedValue(1);
    const error = new BadRequestException('company must not be empty');

    await expect(
      lastValueFrom(
        interceptor.intercept(
          context({ 'idempotency-key': 'key-1' }),
          handler(throwError(() => error)),
        ),
      ),
    ).rejects.toBe(error);
    expect(mockClient.del).toHaveBeenCalledWith(REDIS_KEY);
  });

  it('still rethrows the handler error when releasing the key fails', async () => {
    mockClient.set.mockResolvedValue('OK');
    mockClient.del.mockRejectedValue(new Error('ECONNREFUSED'));
    const error = new BadRequestException('bad');

    await expect(
      lastValueFrom(
        interceptor.intercept(
          context({ 'idempotency-key': 'key-1' }),
          handler(throwError(() => error)),
        ),
      ),
    ).rejects.toBe(error);
  });

  it('runs the request without the guarantee when Redis is down', async () => {
    mockClient.set.mockRejectedValue(new Error('ECONNREFUSED'));
    const next = handler();

    const result = await lastValueFrom(
      interceptor.intercept(context({ 'idempotency-key': 'key-1' }), next),
    );

    expect(result).toEqual({ id: 'job-1' });
    expect(next.handle).toHaveBeenCalled();
    expect(mockClient.set).toHaveBeenCalledTimes(1);
  });

  it('returns the response even when storing it fails', async () => {
    mockClient.set
      .mockResolvedValueOnce('OK')
      .mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await lastValueFrom(
      interceptor.intercept(context({ 'idempotency-key': 'key-1' }), handler()),
    );

    expect(result).toEqual({ id: 'job-1' });
  });

  it('scopes the key to the user so one user cannot replay another', async () => {
    mockClient.set.mockResolvedValue('OK');
    await lastValueFrom(
      interceptor.intercept(
        context({ 'idempotency-key': 'key-1' }, { id: 'u-2' }),
        handler(),
      ),
    );

    expect(mockClient.set.mock.calls[0][0]).toBe('idem:u-2:POST:/jobs:key-1');
  });
});
