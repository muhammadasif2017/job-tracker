import type { NextFunction, Request, Response } from 'express';
import {
  currentRequestId,
  requestIdMiddleware,
  resolveRequestId,
  runJobWithRequestId,
  runWithRequestId,
  withRequestId,
} from './request-context.helper.js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('resolveRequestId', () => {
  it('adopts a well-formed client ID as-is', () => {
    expect(resolveRequestId('trace-abc_123:7.x')).toBe('trace-abc_123:7.x');
  });

  it('takes the first value of a repeated header', () => {
    expect(resolveRequestId(['first-id', 'second-id'])).toBe('first-id');
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['one that could inject a log line', 'id\nlevel=error fake'],
    ['one with spaces', 'has space'],
    ['an oversized one', 'x'.repeat(129)],
  ])('replaces %s with a fresh UUID', (_label, header) => {
    expect(resolveRequestId(header)).toMatch(UUID);
  });
});

describe('requestIdMiddleware', () => {
  function run(headers: Record<string, string>) {
    const req = { headers } as unknown as Request & { id?: string };
    const setHeader = jest.fn();
    const res = { setHeader } as unknown as Response;
    let inContext: string | undefined;
    const next: NextFunction = () => {
      inContext = currentRequestId();
    };
    requestIdMiddleware(req, res, next);
    return { req, setHeader, inContext };
  }

  it('echoes the ID, exposes it as req.id, and runs the request inside its context', () => {
    const { req, setHeader, inContext } = run({
      'x-request-id': 'client-id-1',
    });

    expect(req.id).toBe('client-id-1');
    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', 'client-id-1');
    expect(inContext).toBe('client-id-1');
  });

  it('generates an ID when the client sends none', () => {
    const { req, inContext } = run({});

    expect(req.id).toMatch(UUID);
    expect(inContext).toBe(req.id);
  });
});

describe('context propagation', () => {
  it('has no ID outside a request or job', () => {
    expect(currentRequestId()).toBeUndefined();
  });

  it('keeps the ID across awaits inside the context', async () => {
    const seen = await runWithRequestId('req-1', async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return currentRequestId();
    });

    expect(seen).toBe('req-1');
  });

  it('adds the current ID to job data when there is one', () => {
    expect(withRequestId({ companyId: 'c-1' })).toEqual({ companyId: 'c-1' });
    expect(
      runWithRequestId('req-2', () => withRequestId({ companyId: 'c-1' })),
    ).toEqual({ companyId: 'c-1', requestId: 'req-2' });
  });

  it('runs a job under the ID it carries', () => {
    const seen = runJobWithRequestId(
      { id: '9', queueName: 'q', data: { requestId: 'req-3' } },
      () => currentRequestId(),
    );

    expect(seen).toBe('req-3');
  });

  it('builds an ID from the job itself when none was carried', () => {
    const seen = runJobWithRequestId(
      { id: '42', queueName: 'notifications', data: { roundId: 'r-1' } },
      () => currentRequestId(),
    );

    expect(seen).toBe('job:notifications:42');
  });
});
