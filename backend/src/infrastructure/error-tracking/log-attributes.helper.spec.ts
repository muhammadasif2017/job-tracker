import pino from 'pino';
import {
  ERROR_WITHOUT_MESSAGE,
  fixedMessageForBareErrors,
  scrubLog,
  scrubLogAttributes,
} from './log-attributes.helper.js';
import { appLogger } from './app-logger.helper.js';

describe('scrubLogAttributes', () => {
  it('keeps allowlisted fields and the attributes Sentry adds itself', () => {
    expect(
      scrubLogAttributes({
        requestId: 'req-1',
        context: 'CompanyEnrichmentProcessor',
        jobId: '42',
        'sentry.release': 'abc123',
        'pino.logger.level': 40,
      }),
    ).toEqual({
      requestId: 'req-1',
      context: 'CompanyEnrichmentProcessor',
      jobId: '42',
      'sentry.release': 'abc123',
      'pino.logger.level': 40,
    });
  });

  it('drops any field not on the allowlist, such as an email address', () => {
    const kept = scrubLogAttributes({
      to: 'someone@example.com',
      subject: 'Interview tomorrow',
      requestId: 'req-2',
    });

    expect(kept).toEqual({ requestId: 'req-2' });
  });

  it('keeps only the method and query-free path of a request, never its headers', () => {
    const kept = scrubLogAttributes({
      req: {
        method: 'GET',
        url: '/v1/jobs?search=acme',
        headers: { cookie: 'jt_refresh=secret', host: 'api.example' },
        remoteAddress: '203.0.113.7',
      },
      res: { statusCode: 500, headers: { 'set-cookie': 'x' } },
    });

    expect(kept).toEqual({
      'http.request.method': 'GET',
      'url.path': '/v1/jobs',
      'http.response.status_code': 500,
    });
  });

  it('drops an object under an allowed key, like the context nestjs-pino builds', () => {
    const kept = scrubLogAttributes({
      context: { to: 'someone@example.com', subject: 'Interview' },
      jobId: { nested: 'x' },
      requestId: 'req-3',
    });

    expect(kept).toEqual({ requestId: 'req-3' });
  });

  it('drops the values interpolated into a Sentry message template', () => {
    const kept = scrubLogAttributes({
      'sentry.message.template': 'Hello %s',
      'sentry.message.parameter.0': 'someone@example.com',
      'sentry.release': 'abc123',
    });

    expect(kept).toEqual({ 'sentry.release': 'abc123' });
  });

  it('keeps only the type of a logged error, not its message or stack', () => {
    const kept = scrubLogAttributes({
      err: {
        type: 'Error',
        message: 'ECONNREFUSED',
        stack: 'Error: ECONNREFUSED\n    at x',
        config: { headers: { Authorization: 'Bearer secret' } },
      },
    });

    expect(kept).toEqual({ 'error.type': 'Error' });
  });

  it('ignores req, res and err values that are not objects', () => {
    expect(scrubLogAttributes({ req: 'GET /', res: null, err: 7 })).toEqual({});
  });
});

describe('scrubLog', () => {
  // A context this app registered, as every service's logger does.
  const CONTEXT =
    appLogger({ name: 'ScrubLogSpecService' }) && 'ScrubLogSpecService';
  const err = {
    type: 'PrismaClientValidationError',
    message: 'data: { email: "a@b.com" }',
  };

  it('withholds a message that is the error text pino filled in', () => {
    const sent = scrubLog({
      level: 'error',
      message: err.message,
      attributes: { context: CONTEXT, err },
    });

    expect(sent?.message).toBe(
      'PrismaClientValidationError (message on the VM)',
    );
    expect(sent?.attributes).toEqual({
      context: CONTEXT,
      'error.type': 'PrismaClientValidationError',
    });
  });

  it('keeps a fixed message that the error text merely starts with', () => {
    // The hook, not this fallback, handles pino-filled messages with causes.
    const sent = scrubLog({
      level: 'warn',
      message: 'Failed to send email',
      attributes: {
        context: CONTEXT,
        err: {
          type: 'Error',
          message: 'Failed to send email: validation_error',
        },
      },
    });

    expect(sent?.message).toBe('Failed to send email');
  });

  it('keeps the trace links that attach a line to its span', () => {
    const kept = scrubLogAttributes({
      'sentry.trace.parent_span_id': 'abc',
      'sentry.replay_id': 'r1',
    });

    expect(kept).toEqual({
      'sentry.trace.parent_span_id': 'abc',
      'sentry.replay_id': 'r1',
    });
  });

  it('keeps a fixed message that happens to contain short error text', () => {
    const sent = scrubLog({
      level: 'warn',
      message: 'Request timeout while fetching',
      attributes: {
        context: CONTEXT,
        err: { type: 'Error', message: 'timeout' },
      },
    });

    expect(sent?.message).toBe('Request timeout while fetching');
  });

  it('keeps a fixed message written by our own code', () => {
    const sent = scrubLog({
      level: 'warn',
      message: 'Redis unavailable',
      attributes: { context: CONTEXT, err, requestId: 'req-1' },
    });

    expect(sent?.message).toBe('Redis unavailable');
    expect(sent?.attributes).toEqual({
      context: CONTEXT,
      requestId: 'req-1',
      'error.type': 'PrismaClientValidationError',
    });
  });

  it('keeps the message of a line with no error', () => {
    expect(
      scrubLog({
        level: 'warn',
        message: 'queue_slow',
        attributes: { context: CONTEXT },
      })?.message,
    ).toBe('queue_slow');
  });

  it('drops a line from a logger this app did not create, such as Terminus or Nest core', () => {
    const health = scrubLog({
      level: 'error',
      message:
        'Health Check has failed! {"redis":{"message":"Connection is closed."}}',
      attributes: { context: 'HealthCheckService' },
    });
    // Nest core's Logger.error(err, err.stack) files the stack as the context.
    const shutdown = scrubLog({
      level: 'error',
      message: 'Error logged without a message',
      attributes: {
        context: 'Error: quit failed\n    at RedisService.onModuleDestroy',
      },
    });

    expect(health).toBeNull();
    expect(shutdown).toBeNull();
  });
});

describe('fixedMessageForBareErrors', () => {
  /** A real pino logger with the hook, writing parsed lines to an array. */
  function logger() {
    const lines: Array<Record<string, unknown>> = [];
    const log = pino(
      { hooks: { logMethod: fixedMessageForBareErrors } },
      { write: (line: string) => lines.push(JSON.parse(line)) },
    );
    return { log, lines };
  }

  it('gives an error logged on its own a fixed message, not its text', () => {
    const { log, lines } = logger();

    log.error(new Error('Could not sync a@b.com'));

    expect(lines[0].msg).toBe(ERROR_WITHOUT_MESSAGE);
    expect(lines[0].err).toMatchObject({ message: 'Could not sync a@b.com' });
  });

  it('does the same for an object carrying err, as nestjs-pino passes it', () => {
    const { log, lines } = logger();

    log.error({ context: 'Scheduler', err: new Error('boom') });

    expect(lines[0]).toMatchObject({
      msg: ERROR_WITHOUT_MESSAGE,
      context: 'Scheduler',
    });
  });

  it('also fires when nestjs-pino passes an undefined message after the object', () => {
    // What Nest's Logger.error(err) with a context becomes (the scheduler,
    // the exception handler).
    const method = jest.fn();

    fixedMessageForBareErrors.call(
      {},
      [{ context: 'Scheduler', err: new Error('boom') }, undefined] as never,
      method,
    );

    expect(method).toHaveBeenCalledWith(
      { context: 'Scheduler', err: expect.any(Error) },
      ERROR_WITHOUT_MESSAGE,
    );
  });

  it('leaves a line with its own message alone', () => {
    const { log, lines } = logger();

    log.warn({ err: new Error('boom') }, 'Redis unavailable');
    log.info('plain message');

    expect(lines.map((l) => l.msg)).toEqual([
      'Redis unavailable',
      'plain message',
    ]);
  });
});
