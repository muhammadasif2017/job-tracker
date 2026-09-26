import {
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { GlobalExceptionFilter } from './global-exception.filter.js';
import { reportError } from '../../infrastructure/error-tracking/error-tracking.helper.js';
import { setRedisOutage } from '../../infrastructure/redis/redis-errors.helper.js';

jest.mock(
  '../../infrastructure/error-tracking/error-tracking.helper.js',
  () => ({
    reportError: jest.fn(),
  }),
);

const mockResponse = {
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
};
const mockHost = {
  switchToHttp: jest.fn().mockReturnValue({
    getResponse: jest.fn().mockReturnValue(mockResponse),
    getRequest: jest.fn().mockReturnValue({ url: '/test-path' }),
  }),
};

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;

  beforeEach(() => {
    jest.clearAllMocks();
    mockResponse.status.mockReturnThis();
    mockResponse.json.mockReturnThis();
    filter = new GlobalExceptionFilter();
  });

  it('passes NestJS HttpException through with its own status and body', () => {
    const exception = new HttpException(
      { message: 'Access denied', statusCode: 403 },
      HttpStatus.FORBIDDEN,
    );
    filter.catch(exception, mockHost as never);
    expect(mockResponse.status).toHaveBeenCalledWith(403);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Access denied', statusCode: 403 }),
    );
  });

  it.each([
    ['a timed-out command', new Error('Command timed out')],
    [
      'a command refused while disconnected',
      new Error(
        "Stream isn't writeable and enableOfflineQueue options is false",
      ),
    ],
  ])('maps an unhandled Redis outage (%s) to 503', (_label, exception) => {
    // Debug during a reported outage: RedisService logged it once (ADR-053).
    setRedisOutage(true);
    const debug = jest
      .spyOn(Logger.prototype, 'debug')
      .mockImplementation(() => undefined);

    filter.catch(exception, mockHost as never);
    setRedisOutage(false);

    expect(mockResponse.status).toHaveBeenCalledWith(503);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 503,
        error: 'Service Unavailable',
        path: '/test-path',
      }),
    );
    expect(debug).toHaveBeenCalledWith({ err: exception }, 'Redis unavailable');
    debug.mockRestore();
  });

  it('warns about a Redis 503 when no outage is reported, such as a timeout on a live connection', () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const exception = new Error('Command timed out');

    filter.catch(exception, mockHost as never);

    expect(mockResponse.status).toHaveBeenCalledWith(503);
    expect(warn).toHaveBeenCalledWith({ err: exception }, 'Redis unavailable');
    warn.mockRestore();
  });

  it('keeps a Redis error that is not an outage a 500', () => {
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    filter.catch(new Error('WRONGPASS invalid password'), mockHost as never);

    expect(mockResponse.status).toHaveBeenCalledWith(500);
    error.mockRestore();
  });

  it('adds the correlation ID from the request to the error body', () => {
    const host = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => ({ url: '/v1/jobs/x', id: 'req-err-1' }),
      }),
    };

    filter.catch(new NotFoundException('Job not found'), host as never);

    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404, requestId: 'req-err-1' }),
    );
  });

  it('omits requestId when the request has none', () => {
    filter.catch(new NotFoundException('Job not found'), mockHost as never);

    expect(mockResponse.json.mock.calls[0][0]).not.toHaveProperty('requestId');
  });

  it('maps Prisma P2002 (unique constraint) to 409 Conflict', () => {
    filter.catch({ code: 'P2002' }, mockHost as never);
    expect(mockResponse.status).toHaveBeenCalledWith(409);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 409, error: 'Conflict' }),
    );
  });

  it('maps Prisma P2025 (record not found) to 404 Not Found', () => {
    filter.catch({ code: 'P2025' }, mockHost as never);
    expect(mockResponse.status).toHaveBeenCalledWith(404);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404, error: 'Not Found' }),
    );
  });

  it('returns 500 for unknown errors without leaking internal details', () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    filter.catch(new Error('pg: connection refused'), mockHost as never);
    expect(mockResponse.status).toHaveBeenCalledWith(500);
    const body = mockResponse.json.mock.calls[0][0] as {
      message: string;
      timestamp: string;
      path: string;
    };
    expect(body.message).toBe('Internal server error');
    expect(body.path).toBe('/test-path');
    expect(typeof body.timestamp).toBe('string');
    expect(body).not.toHaveProperty('stack');
  });

  it('falls back to a bare 500 when building the response itself throws', () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const brokenHost = {
      switchToHttp: jest.fn().mockReturnValue({
        getResponse: jest.fn().mockReturnValue(mockResponse),
        getRequest: jest.fn().mockImplementation(() => {
          throw new Error('request context unavailable');
        }),
      }),
    };
    filter.catch(new Error('boom'), brokenHost as never);
    expect(mockResponse.status).toHaveBeenCalledWith(500);
    const body = mockResponse.json.mock.calls[0][0] as { message: string };
    expect(body.message).toBe('Internal server error');
  });

  describe('Sentry reporting (ADR-050)', () => {
    function hostWith(request: object) {
      return {
        switchToHttp: () => ({
          getResponse: () => mockResponse,
          getRequest: () => request,
        }),
      };
    }

    it('reports an unexpected 500 with the request ID and user ID', () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      const err = new Error('db exploded');

      filter.catch(
        err,
        hostWith({
          method: 'GET',
          url: '/v1/jobs/clx9abc',
          baseUrl: '',
          route: { path: '/v1/jobs/:id' },
          id: 'req-7',
          user: { id: 'u-7' },
        }) as never,
      );

      expect(reportError).toHaveBeenCalledWith(err, {
        requestId: 'req-7',
        userId: 'u-7',
        // Named by route template, so the record ID stays out of the title.
        transaction: 'GET /v1/jobs/:id',
      });
    });

    it.each([
      ['a 404 HttpException', new NotFoundException('Job not found')],
      ['a Prisma unique violation (409)', { code: 'P2002' }],
      ['a Prisma not-found (404)', { code: 'P2025' }],
      ['a Redis outage mapped to 503', new Error('Command timed out')],
    ])('does not report %s', (_label, exception) => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

      filter.catch(exception, hostWith({ url: '/v1/jobs' }) as never);

      expect(reportError).not.toHaveBeenCalled();
    });

    it('still reports the original error when the filter itself fails', () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      const err = new Error('original');
      const brokenHost = {
        switchToHttp: () => ({
          getResponse: () => mockResponse,
          getRequest: () => {
            throw new Error('request context unavailable');
          },
        }),
      };

      filter.catch(err, brokenHost as never);

      expect(reportError).toHaveBeenCalledWith(err, {});
    });

    it('does not report again when sending an already-judged response fails', () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      const throwingResponse = {
        status: jest.fn().mockReturnThis(),
        json: jest
          .fn()
          .mockImplementationOnce(() => {
            throw new Error('ERR_HTTP_HEADERS_SENT');
          })
          .mockReturnThis(),
      };
      const host = {
        switchToHttp: () => ({
          getResponse: () => throwingResponse,
          getRequest: () => ({ url: '/v1/jobs/1/resumes/file', id: 'r-1' }),
        }),
      };

      // A 404 thrown after headers went out: judged not reportable, and the
      // failed send must not report it after all.
      filter.catch(new NotFoundException('gone'), host as never);

      expect(reportError).not.toHaveBeenCalled();
    });
  });
});
